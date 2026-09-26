import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  type ProjectStage,
  type ProjectTimelineView,
  type Role,
  type SaveProjectTimelineInput,
  type TimelineTaskView,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { HolidaysService } from '../holidays/holidays.service.js';
import { MandayService } from './manday.service.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

const PLAN_INCLUDE = {
  project: {
    select: {
      id: true,
      name: true,
      stage: true,
      startsAt: true,
      goLiveAt: true,
      node: { select: { id: true, name: true } },
    },
  },
  tasks: {
    orderBy: [{ stage: 'asc' }, { position: 'asc' }],
    include: { efforts: true },
  },
} satisfies Prisma.MandayPlanInclude;

type PlanRow = Prisma.MandayPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

/** What the project row looks like to the audit trail, on both sides of a save. */
const PROJECT_AUDIT_SELECT = {
  id: true,
  name: true,
  startsAt: true,
  goLiveAt: true,
} satisfies Prisma.ProjectSelect;

/**
 * When a project's work is scheduled.
 *
 * The rows are the mandays plan's tasks — the same tasks, not a copy. The plan
 * answers "how many days"; this answers "which days". They are two services
 * because they follow two different rules: the estimate freezes the moment it
 * goes for approval, and the schedule must keep moving, because reality does.
 */
@Injectable()
export class TimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    private readonly mandays: MandayService,
    private readonly holidays: HolidaysService,
  ) {}

  async getForProject(projectId: string, actor: AuthenticatedUser): Promise<ProjectTimelineView> {
    // Authorises, and seeds the standard task breakdown when this project has
    // never been estimated — so the timeline is never an empty page that gives
    // the reader nothing to schedule.
    await this.mandays.getForProject(projectId, actor);

    const nodeId = await this.access.nodeIdOfProject(projectId);
    const access = await this.access.requireCapability(
      actor.id,
      actor.role as Role,
      nodeId,
      'viewProject',
    );

    const plan = await this.prisma.mandayPlan.findUnique({
      where: { projectId },
      include: PLAN_INCLUDE,
    });
    if (!plan) throw AppException.notFound('Timeline');

    return toView(plan, access.capabilities.manageProject, await this.holidaysFor(plan));
  }

  /**
   * The non-working days this schedule spans.
   *
   * Widened by a year on each side of the plan's own dates: a reader who drags
   * the project start forward should not have to reload to find out that the
   * calendar stopped there. Cheap — a country has a few dozen holidays a year.
   */
  private async holidaysFor(plan: PlanRow): Promise<{ date: string; name: string }[]> {
    const stamps = [
      plan.project.startsAt,
      plan.project.goLiveAt,
      ...plan.tasks.flatMap((task) => [
        task.startsAt,
        task.endsAt,
        task.actualStartsAt,
        task.actualEndsAt,
      ]),
    ]
      .filter((value): value is Date => value instanceof Date)
      .map((value) => value.getTime());

    const now = Date.now();
    const first = stamps.length > 0 ? Math.min(...stamps) : now;
    const last = stamps.length > 0 ? Math.max(...stamps) : now;

    const year = 365 * 86_400_000;
    return this.holidays.namedForRange(new Date(first - year), new Date(last + year));
  }

  /**
   * Replaces the whole schedule: the project window and every task's dates.
   *
   * Whole-document, like the estimate and the settings form, and guarded the
   * same way — a tab left open since yesterday must not silently overwrite what
   * somebody saved this morning.
   */
  async save(
    projectId: string,
    input: SaveProjectTimelineInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<ProjectTimelineView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'manageProject');

    const plan = await this.prisma.mandayPlan.findUnique({
      where: { projectId },
      include: PLAN_INCLUDE,
    });
    if (!plan) throw AppException.notFound('Timeline');

    // `!== undefined`, not truthiness: `null` is the caller saying "I loaded a
    // schedule that had never been saved", which is still a claim about what
    // they were looking at.
    if (
      input.expectedUpdatedAt !== undefined &&
      plan.updatedAt.toISOString() !== input.expectedUpdatedAt
    ) {
      throw AppException.conflict(
        'Timeline sudah diubah di tempat lain. Muat ulang halaman lalu ulangi perubahan Anda.',
      );
    }

    // Anything not on this plan is not this caller's to reschedule.
    const known = new Set(plan.tasks.map((task) => task.id));
    const unknown = input.tasks.find((task) => !known.has(task.id));
    if (unknown) {
      throw AppException.validation([
        { field: 'tasks', message: 'Ada task yang bukan milik project ini' },
      ]);
    }

    const before = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: PROJECT_AUDIT_SELECT,
    });

    const after = await this.prisma.$transaction(async (tx) => {
      for (const task of input.tasks) {
        await tx.mandayTask.update({
          where: { id: task.id },
          data: {
            startsAt: task.startsAt ? new Date(task.startsAt) : null,
            endsAt: task.endsAt ? new Date(task.endsAt) : null,
            progressPercent: task.progressPercent,
            actualStartsAt: task.actualStartsAt ? new Date(task.actualStartsAt) : null,
            actualEndsAt: task.actualEndsAt ? new Date(task.actualEndsAt) : null,
          },
        });
      }

      // Touching the plan is what moves `updatedAt`, which is the version the
      // next save will be checked against.
      await tx.mandayPlan.update({ where: { id: plan.id }, data: { updatedAt: new Date() } });

      return tx.project.update({
        where: { id: projectId },
        data: {
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          goLiveAt: input.goLiveAt ? new Date(input.goLiveAt) : null,
        },
        select: PROJECT_AUDIT_SELECT,
      });
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.PROJECT_UPDATED,
      entity: 'Project',
      entityId: projectId,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      // The window is a row change the snapshot can express; the task dates are
      // many rows, so the trail records how many moved rather than all of them.
      before,
      after,
      metadata: { timelineTasksSaved: input.tasks.length },
    });

    return this.getForProject(projectId, actor);
  }
}

function toView(
  plan: PlanRow,
  canEdit: boolean,
  holidays: { date: string; name: string }[],
): ProjectTimelineView {
  const tasks: TimelineTaskView[] = plan.tasks.map((task) => ({
    id: task.id,
    parentId: task.parentId,
    stage: task.stage as ProjectStage,
    name: task.name,
    position: task.position,
    startsAt: task.startsAt?.toISOString() ?? null,
    endsAt: task.endsAt?.toISOString() ?? null,
    progressPercent: task.progressPercent,
    actualStartsAt: task.actualStartsAt?.toISOString() ?? null,
    actualEndsAt: task.actualEndsAt?.toISOString() ?? null,
    estimatedDays: task.efforts.reduce((sum, effort) => sum + Number(effort.days), 0),
  }));

  return {
    projectId: plan.project.id,
    projectName: plan.project.name,
    node: { id: plan.project.node.id, name: plan.project.node.name },
    stage: plan.project.stage as ProjectStage,
    startsAt: plan.project.startsAt?.toISOString() ?? null,
    goLiveAt: plan.project.goLiveAt?.toISOString() ?? null,
    tasks,
    holidays,
    canEdit,
    updatedAt: plan.updatedAt.toISOString(),
  };
}
