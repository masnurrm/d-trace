import { Injectable } from '@nestjs/common';
import {
  PROJECT_JOB_ROLES,
  PROJECT_JOB_ROLE_LABELS,
  PROJECT_STAGES,
  PROJECT_STAGE_LABELS,
  formatDays,
  type DocumentContext,
  type MandayActivityData,
  type MandayActivityRow,
  type MandayEffortData,
  type ProjectData,
  type ProjectDataSet,
  type ProjectDataset,
  type ProjectJobRole,
  type ProjectStage,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WEEKS = 104;

/** Ancestors are walked one query per level; a tree deeper than this is a bug. */
const MAX_DEPTH = 12;

interface PlanTask {
  id: string;
  parentId: string | null;
  stage: ProjectStage;
  name: string;
  position: number;
  startsAt: Date | null;
  endsAt: Date | null;
  efforts: Partial<Record<ProjectJobRole, number>>;
}

interface Plan {
  roles: ProjectJobRole[];
  tasks: PlanTask[];
}

/**
 * What a document can take from the rest of its project.
 *
 * Two things: the values `{{placeholders}}` resolve to, and the datasets a
 * `DATA` section lays out. Both are read-only views of other screens — this
 * service never writes, and it never creates the mandays plan (opening
 * Mandays does that); a project without one simply has empty tables.
 *
 * Access is the caller's job: every method takes a project the caller has
 * already been allowed to read.
 */
@Injectable()
export class ProjectDataService {
  constructor(private readonly prisma: PrismaService) {}

  async context(projectId: string): Promise<DocumentContext> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        code: true,
        description: true,
        startsAt: true,
        goLiveAt: true,
        stage: true,
        node: { select: { id: true, name: true, code: true } },
        members: {
          orderBy: { createdAt: 'asc' },
          select: { jobRole: true, user: { select: { name: true, email: true } } },
        },
      },
    });
    if (!project) throw AppException.notFound('Project');

    const [hierarchy, plan] = await Promise.all([
      this.hierarchy(project.node.id),
      this.plan(projectId),
    ]);

    const team: DocumentContext['team'] = {};
    for (const member of project.members) {
      const entry = team[member.jobRole];
      if (entry) {
        entry.names = `${entry.names}, ${member.user.name}`;
      } else {
        team[member.jobRole] = {
          name: member.user.name,
          email: member.user.email,
          names: member.user.name,
        };
      }
    }

    const total = plan ? leaves(plan.tasks).reduce((sum, task) => sum + effortOf(task, plan.roles), 0) : 0;

    return {
      project: {
        name: project.name,
        code: project.code,
        description: project.description ?? '',
        startsAt: formatDate(project.startsAt),
        goLiveAt: formatDate(project.goLiveAt),
        stage: PROJECT_STAGE_LABELS[project.stage as ProjectStage],
      },
      node: { name: project.node.name, code: project.node.code },
      hierarchy,
      team,
      mandays: { total: formatDays(total) },
      today: formatDate(new Date()),
    };
  }

  /** Every dataset, computed now. */
  async datasets(projectId: string): Promise<ProjectDataSet> {
    const [plan, resources] = await Promise.all([this.plan(projectId), this.resources(projectId)]);
    return {
      MANDAY_ACTIVITY: activity(plan),
      MANDAY_EFFORT: effort(plan, resources),
    };
  }

  async dataset(projectId: string, dataset: ProjectDataset): Promise<ProjectData> {
    const all = await this.datasets(projectId);
    return all[dataset]!;
  }

  /* ------------------------------------------------------------------ */

  /** The node and every ancestor, keyed by node type code; nearest wins. */
  private async hierarchy(nodeId: string): Promise<DocumentContext['hierarchy']> {
    const result: DocumentContext['hierarchy'] = {};
    let currentId: string | null = nodeId;

    for (let level = 0; currentId && level < MAX_DEPTH; level += 1) {
      const node: {
        name: string;
        code: string;
        parentId: string | null;
        type: { code: string };
      } | null = await this.prisma.node.findUnique({
        where: { id: currentId },
        select: { name: true, code: true, parentId: true, type: { select: { code: true } } },
      });
      if (!node) break;
      result[node.type.code] ??= { name: node.name, code: node.code };
      currentId = node.parentId;
    }

    return result;
  }

  private async plan(projectId: string): Promise<Plan | null> {
    const plan = await this.prisma.mandayPlan.findUnique({
      where: { projectId },
      select: {
        roles: true,
        tasks: {
          select: {
            id: true,
            parentId: true,
            stage: true,
            name: true,
            position: true,
            startsAt: true,
            endsAt: true,
            efforts: { select: { jobRole: true, days: true } },
          },
        },
      },
    });
    if (!plan) return null;

    const tasks: PlanTask[] = plan.tasks.map((task) => ({
      id: task.id,
      parentId: task.parentId,
      stage: task.stage as ProjectStage,
      name: task.name,
      position: task.position,
      startsAt: task.startsAt,
      endsAt: task.endsAt,
      efforts: Object.fromEntries(
        task.efforts.map((effort) => [effort.jobRole, Number(effort.days)]),
      ) as PlanTask['efforts'],
    }));

    // Stage order from the shared constant; SQL would sort the enum by name.
    tasks.sort(
      (a, b) =>
        PROJECT_STAGES.indexOf(a.stage) - PROJECT_STAGES.indexOf(b.stage) ||
        a.position - b.position,
    );

    return { roles: plan.roles as ProjectJobRole[], tasks };
  }

  private async resources(projectId: string): Promise<MandayEffortData['resources']> {
    const counts = await this.prisma.projectMember.groupBy({
      by: ['jobRole'],
      where: { projectId },
      _count: { _all: true },
    });
    const byRole = new Map(counts.map((row) => [row.jobRole as ProjectJobRole, row._count._all]));

    return PROJECT_JOB_ROLES.filter((role) => byRole.has(role)).map((role) => ({
      role,
      label: PROJECT_JOB_ROLE_LABELS[role],
      count: byRole.get(role)!,
    }));
  }
}

/* -------------------------------------------------------------------------- */
/* Datasets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The estimate as a Plan & Activity table: a banner per stage, a heading per
 * parent task carrying its subtotal, and a row per leaf. Days live on leaves;
 * everything above them is a sum, never a number of its own.
 */
function activity(plan: Plan | null): MandayActivityData {
  if (!plan) return { dataset: 'MANDAY_ACTIVITY', roles: [], rows: [], totals: { byRole: {}, total: 0 } };

  const roles = plan.roles;
  const children = childrenOf(plan.tasks);
  const rows: MandayActivityRow[] = [];

  const sumOf = (list: PlanTask[]) => {
    const byRole: Record<string, number> = {};
    for (const role of roles) byRole[role] = round(list.reduce((sum, task) => sum + (task.efforts[role] ?? 0), 0));
    return { byRole, total: round(Object.values(byRole).reduce((sum, value) => sum + value, 0)) };
  };

  const descendantLeaves = (task: PlanTask): PlanTask[] => {
    const kids = children.get(task.id) ?? [];
    return kids.length === 0 ? [task] : kids.flatMap(descendantLeaves);
  };

  const walk = (task: PlanTask, depth: number) => {
    const kids = children.get(task.id) ?? [];
    const sum = sumOf(descendantLeaves(task));
    rows.push({
      kind: kids.length > 0 ? 'group' : 'task',
      name: task.name,
      depth,
      efforts: sum.byRole,
      total: sum.total,
    });
    for (const kid of kids) walk(kid, depth + 1);
  };

  for (const stage of PROJECT_STAGES) {
    const top = plan.tasks.filter((task) => task.stage === stage && !task.parentId);
    if (top.length === 0) continue;

    const sum = sumOf(top.flatMap(descendantLeaves));
    rows.push({ kind: 'stage', name: PROJECT_STAGE_LABELS[stage], depth: 0, efforts: sum.byRole, total: sum.total });
    for (const task of top) walk(task, 0);
  }

  return {
    dataset: 'MANDAY_ACTIVITY',
    roles: roles.map((role) => ({ role, label: PROJECT_JOB_ROLE_LABELS[role] })),
    rows: rows.slice(0, 600),
    totals: sumOf(leaves(plan.tasks)),
  };
}

/**
 * Effort per role, spread week by week across the timeline.
 *
 * Each leaf's days are shared evenly over the working days between its start
 * and end, then summed into Monday-based weeks counted from the earliest
 * start. A leaf the timeline has not dated is still in the totals — it is
 * estimated work — but in no week, and `unscheduled` says how much of that
 * there is so a reader is not left wondering why the weeks do not add up.
 */
function effort(plan: Plan | null, resources: MandayEffortData['resources']): MandayEffortData {
  if (!plan) {
    return { dataset: 'MANDAY_EFFORT', startsOn: null, weekCount: 0, roles: [], total: 0, unscheduled: 0, resources };
  }

  const roles = plan.roles;
  const work = leaves(plan.tasks).filter((task) => effortOf(task, roles) > 0);
  const scheduled = work.filter((task) => task.startsAt && task.endsAt);

  const firstDay = scheduled.length
    ? Math.min(...scheduled.map((task) => dayNumber(task.startsAt!)))
    : null;
  // Day 0 of the epoch was a Thursday; step back to that week's Monday.
  const weekStart = firstDay === null ? null : firstDay - ((firstDay + 3) % 7);

  const weeks = new Map<ProjectJobRole, number[]>(roles.map((role) => [role, []]));
  let weekCount = 0;

  if (weekStart !== null) {
    for (const task of scheduled) {
      const start = dayNumber(task.startsAt!);
      const end = Math.max(start, dayNumber(task.endsAt!));
      const all = range(start, end);
      const working = all.filter((day) => (day + 3) % 7 < 5);
      // A task dated only across a weekend still happened; spread it there.
      const days = working.length > 0 ? working : all;

      for (const role of roles) {
        const share = (task.efforts[role] ?? 0) / days.length;
        if (share === 0) continue;
        const series = weeks.get(role)!;
        for (const day of days) {
          const index = Math.floor((day - weekStart) / 7);
          if (index >= MAX_WEEKS) continue;
          series[index] = (series[index] ?? 0) + share;
          weekCount = Math.max(weekCount, index + 1);
        }
      }
    }
  }

  const roleRows = roles.map((role) => {
    const series = weeks.get(role)!;
    return {
      role,
      label: PROJECT_JOB_ROLE_LABELS[role],
      weeks: Array.from({ length: weekCount }, (_, index) => round(series[index] ?? 0)),
      total: round(work.reduce((sum, task) => sum + (task.efforts[role] ?? 0), 0)),
    };
  });

  const unscheduled = work
    .filter((task) => !(task.startsAt && task.endsAt))
    .reduce((sum, task) => sum + effortOf(task, roles), 0);

  return {
    dataset: 'MANDAY_EFFORT',
    startsOn: weekStart === null ? null : new Date(weekStart * DAY_MS).toISOString().slice(0, 10),
    weekCount,
    roles: roleRows,
    total: round(roleRows.reduce((sum, row) => sum + row.total, 0)),
    unscheduled: round(unscheduled),
    resources,
  };
}

/* -------------------------------------------------------------------------- */

function childrenOf(tasks: PlanTask[]): Map<string, PlanTask[]> {
  const map = new Map<string, PlanTask[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const list = map.get(task.parentId) ?? [];
    list.push(task);
    map.set(task.parentId, list);
  }
  return map;
}

function leaves(tasks: PlanTask[]): PlanTask[] {
  const parents = new Set(tasks.map((task) => task.parentId).filter(Boolean));
  return tasks.filter((task) => !parents.has(task.id));
}

function effortOf(task: PlanTask, roles: ProjectJobRole[]): number {
  return roles.reduce((sum, role) => sum + (task.efforts[role] ?? 0), 0);
}

/**
 * The calendar day a stored date stands for, as days since the epoch.
 *
 * Dates are saved as local midnight — 17:00Z the day before, in WIB — so the
 * UTC day would be one off. Rounding to the *nearest* midnight reads both
 * that and a true UTC midnight as the day that was meant.
 */
function dayNumber(date: Date): number {
  return Math.round(date.getTime() / DAY_MS);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatDate(date: Date | null): string {
  if (!date) return '';
  // Same nearest-midnight reading as `dayNumber`, then printed as that day.
  const day = new Date(dayNumber(date) * DAY_MS);
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(day);
}
