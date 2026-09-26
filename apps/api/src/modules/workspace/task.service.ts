import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  PROJECT_STAGE_LABELS,
  type DevStatus,
  type ProjectStage,
  type ProjectTaskView,
  type Role,
  type SaveProjectTaskInput,
  type TaskPriority,
  type TestStatus,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

const TASK_INCLUDE = {
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.ProjectTaskInclude;

type TaskRow = Prisma.ProjectTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

/** The whole task, on both sides of a change, minus the joined assignee. */
const AUDIT_SELECT = {
  id: true,
  projectId: true,
  module: true,
  category: true,
  description: true,
  priority: true,
  assigneeId: true,
  devPlanStart: true,
  devPlanEnd: true,
  devActualStart: true,
  devActualEnd: true,
  devCompletion: true,
  devStatus: true,
  testPlanStart: true,
  testPlanEnd: true,
  testActualStart: true,
  testActualEnd: true,
  testCompletion: true,
  testStatus: true,
  remark: true,
  position: true,
} satisfies Prisma.ProjectTaskSelect;

const toDate = (value: string | null) => (value ? new Date(value) : null);

/**
 * The module task list for a project.
 *
 * Returned whole rather than paginated: a project's task list is tens of rows,
 * not thousands, and the screen filters, sorts, totals and exports across all
 * of them at once. Paginating would make every one of those operations either
 * wrong or another round trip.
 */
@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
  ) {}

  async listForProject(projectId: string, actor: AuthenticatedUser): Promise<ProjectTaskView[]> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'viewProject');

    await this.seedFromEstimate(projectId);

    const rows = await this.prisma.projectTask.findMany({
      where: { projectId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: TASK_INCLUDE,
      // A ceiling rather than pages: far above any real project, and low
      // enough that one bad import cannot take the screen down with it.
      take: 500,
    });

    return rows.map(toView);
  }

  /**
   * Fills an empty task list from the mandays estimate, once.
   *
   * The estimate already names the work and typing it a second time into this
   * screen is how the two drift apart, so the first visit copies it across,
   * with whatever dates the Timeline has given as the planned development
   * window. The rows are ordinary afterwards: renameable, re-datable,
   * deletable.
   *
   * **Only the Develop stage.** This screen tracks a task through development
   * and then through testing, and "Define Scope" or "Prepare Project Plan"
   * never travels that road — every one of those rows landed here Unready for
   * Dev and stayed there, seventeen rows of permanent noise around the three
   * that meant something. The rest of the estimate is still estimated and still
   * scheduled on the Timeline; it is only this list that is about build work.
   *
   * **Only the leaves.** A parent in the estimate is a roll-up of its children,
   * not work of its own, so seeding both would list the same task twice. The
   * effort filter already selects them: days live on the leaf.
   *
   * The parent's name becomes the module, which is what the estimate's own tree
   * means — "Master Jabatan" broken into "Menu Master Jabatan". A leaf sitting
   * directly under the stage has no parent to name it, so it falls back to the
   * stage label rather than leaving a blank somebody has to fill in before the
   * screen reads.
   *
   * Three things keep it from running twice. It only fires when the estimate
   * has real numbers on it, so an untouched project copies nothing. It only
   * fires when no task exists yet. And it stamps `tasksSeededAt`, which is what
   * makes a deletion stick — counting rows instead would bring the whole list
   * back the moment somebody cleared it.
   *
   * The update is conditional on the marker still being null, so two visits
   * landing at once cannot both seed: the second updates no row and stops.
   */
  private async seedFromEstimate(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { tasksSeededAt: true, _count: { select: { tasks: true } } },
    });
    if (!project || project.tasksSeededAt !== null || project._count.tasks > 0) return;

    const estimateTree = await this.prisma.mandayTask.findMany({
      where: {
        plan: { projectId },
        stage: 'DEVELOP',
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        parentId: true,
        stage: true,
        name: true,
        position: true,
        startsAt: true,
        endsAt: true,
        efforts: { select: { days: true } },
      },
    });
    const byId = new Map(estimateTree.map((task) => [task.id, task]));
    const lineageOf = (task: (typeof estimateTree)[number]) => {
      const lineage: (typeof estimateTree)[number][] = [];
      let current: (typeof estimateTree)[number] | undefined = task;
      const seen = new Set<string>();

      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        lineage.unshift(current);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return lineage;
    };

    const estimated = estimateTree
      .filter((task) => task.efforts.some((effort) => Number(effort.days) > 0))
      .map((task) => ({ task, lineage: lineageOf(task) }))
      .sort((a, b) => {
        const length = Math.max(a.lineage.length, b.lineage.length);
        for (let index = 0; index < length; index += 1) {
          const difference =
            (a.lineage[index]?.position ?? -1) - (b.lineage[index]?.position ?? -1);
          if (difference !== 0) return difference;
        }
        return 0;
      });
    if (estimated.length === 0) return;

    const claimed = await this.prisma.project.updateMany({
      where: { id: projectId, tasksSeededAt: null },
      data: { tasksSeededAt: new Date() },
    });
    if (claimed.count === 0) return;

    await this.prisma.projectTask.createMany({
      data: estimated.map(({ task, lineage }, index) => ({
        projectId,
        module:
          lineage.length >= 2 ? lineage[0]!.name : PROJECT_STAGE_LABELS[task.stage as ProjectStage],
        category: lineage.length >= 3 ? lineage[1]!.name : null,
        description: task.name,
        devPlanStart: task.startsAt,
        devPlanEnd: task.endsAt,
        position: index,
      })),
    });
  }

  async create(
    projectId: string,
    input: SaveProjectTaskInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<ProjectTaskView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'createDocument');

    const last = await this.prisma.projectTask.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const row = await this.prisma.projectTask.create({
      data: {
        projectId,
        position: (last?.position ?? -1) + 1,
        createdById: actor.id,
        ...toData(input),
      },
      include: TASK_INCLUDE,
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.PROJECT_TASK_CREATED,
      entity: 'ProjectTask',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      after: pickAudit(row),
    });

    return toView(row);
  }

  async update(
    id: string,
    input: SaveProjectTaskInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<ProjectTaskView> {
    const before = await this.prisma.projectTask.findUnique({
      where: { id },
      select: AUDIT_SELECT,
    });
    if (!before) throw AppException.notFound('Task');

    const nodeId = await this.access.nodeIdOfProject(before.projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'createDocument');

    const row = await this.prisma.projectTask.update({
      where: { id },
      data: toData(input),
      include: TASK_INCLUDE,
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.PROJECT_TASK_UPDATED,
      entity: 'ProjectTask',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before,
      after: pickAudit(row),
    });

    return toView(row);
  }

  /**
   * Copies a task in directly below the one it came from.
   *
   * Below, not at the end: a duplicate is made because the next task is nearly
   * the same as this one, and appending it eighty rows away loses the very
   * adjacency that made duplicating worth doing.
   *
   * Everything is carried over, dates and statuses included. A copy that reset
   * them would be a blank row with the description filled in — which the Add
   * Task button already gives, in one click rather than two.
   *
   * The shift and the insert run in one transaction: a shift that landed
   * without its insert would leave a gap in the ordering, and two duplicates
   * racing would otherwise both claim the same position.
   */
  async duplicate(
    id: string,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<ProjectTaskView> {
    const source = await this.prisma.projectTask.findUnique({
      where: { id },
      select: AUDIT_SELECT,
    });
    if (!source) throw AppException.notFound('Task');

    const nodeId = await this.access.nodeIdOfProject(source.projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'createDocument');

    const { id: _id, position, projectId, ...fields } = source;

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.projectTask.updateMany({
        where: { projectId, position: { gt: position } },
        data: { position: { increment: 1 } },
      });

      return tx.projectTask.create({
        data: { ...fields, projectId, position: position + 1, createdById: actor.id },
        include: TASK_INCLUDE,
      });
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.PROJECT_TASK_CREATED,
      entity: 'ProjectTask',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      after: pickAudit(row),
    });

    return toView(row);
  }

  async remove(id: string, actor: AuthenticatedUser, client: ClientInfo): Promise<void> {
    const before = await this.prisma.projectTask.findUnique({
      where: { id },
      select: AUDIT_SELECT,
    });
    if (!before) throw AppException.notFound('Task');

    const nodeId = await this.access.nodeIdOfProject(before.projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'createDocument');

    // A hard delete, unlike a document: a task is a planning row, not evidence.
    // What it was is preserved in the audit snapshot below.
    await this.prisma.projectTask.delete({ where: { id } });

    await this.audit.record({
      action: AUDIT_ACTIONS.PROJECT_TASK_DELETED,
      entity: 'ProjectTask',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before,
    });
  }
}

function toData(input: SaveProjectTaskInput) {
  return {
    module: input.module,
    category: input.category,
    description: input.description,
    priority: input.priority as TaskPriority,
    assigneeId: input.assigneeId,

    devPlanStart: toDate(input.devPlanStart),
    devPlanEnd: toDate(input.devPlanEnd),
    devActualStart: toDate(input.devActualStart),
    devActualEnd: toDate(input.devActualEnd),
    devCompletion: input.devCompletion,
    devStatus: input.devStatus as DevStatus,

    testPlanStart: toDate(input.testPlanStart),
    testPlanEnd: toDate(input.testPlanEnd),
    testActualStart: toDate(input.testActualStart),
    testActualEnd: toDate(input.testActualEnd),
    testCompletion: input.testCompletion,
    testStatus: input.testStatus as TestStatus,

    remark: input.remark,
  };
}

function pickAudit(row: TaskRow) {
  const {
    assignee: _assignee,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdById: _createdById,
    ...rest
  } = row;
  return rest;
}

function toView(row: TaskRow): ProjectTaskView {
  return {
    id: row.id,
    projectId: row.projectId,
    module: row.module,
    category: row.category,
    description: row.description,
    priority: row.priority as TaskPriority,
    assigneeId: row.assigneeId,
    assigneeName: row.assignee?.name ?? null,

    devPlanStart: row.devPlanStart?.toISOString() ?? null,
    devPlanEnd: row.devPlanEnd?.toISOString() ?? null,
    devActualStart: row.devActualStart?.toISOString() ?? null,
    devActualEnd: row.devActualEnd?.toISOString() ?? null,
    devCompletion: row.devCompletion,
    devStatus: row.devStatus as DevStatus,

    testPlanStart: row.testPlanStart?.toISOString() ?? null,
    testPlanEnd: row.testPlanEnd?.toISOString() ?? null,
    testActualStart: row.testActualStart?.toISOString() ?? null,
    testActualEnd: row.testActualEnd?.toISOString() ?? null,
    testCompletion: row.testCompletion,
    testStatus: row.testStatus as TestStatus,

    remark: row.remark,
    position: row.position,
    updatedAt: row.updatedAt.toISOString(),
  };
}
