import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  DEFAULT_MANDAY_TASKS,
  PROJECT_STAGES,
  type MandayPlanView,
  type MandayStatus,
  type MandayTaskView,
  type ProjectJobRole,
  type ProjectStage,
  type Role,
  type SaveMandayPlanInput,
  type SubmitMandayPlanInput,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

const PLAN_INCLUDE = {
  project: {
    select: {
      id: true,
      name: true,
      nodeId: true,
      stage: true,
      node: { select: { id: true, name: true } },
    },
  },
  tasks: {
    orderBy: [{ stage: 'asc' }, { position: 'asc' }],
    include: { efforts: true },
  },
} satisfies Prisma.MandayPlanInclude;

type PlanRow = Prisma.MandayPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

/** The columns a brand-new plan starts with. */
const DEFAULT_ROLES: ProjectJobRole[] = ['BA', 'DEVELOPER', 'QA'];

/**
 * The mandays estimate for a project.
 *
 * One plan per project, created on first open rather than by a separate step —
 * an estimate nobody has filled in is indistinguishable from one that does not
 * exist, so there is nothing to ask the user about.
 *
 * Submitting does not stop the editing. It marks the breakdown as settled,
 * which is what opens the Timeline, Task Activity and Bug Tracking — but the
 * estimator stays on their own feet, because nothing in the app can unlock a
 * plan again and a submit that locked would be a door with no handle on the
 * far side. Only an explicit APPROVED does, and that is somebody's decision.
 */
@Injectable()
export class MandayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly notifications: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  async getForProject(projectId: string, actor: AuthenticatedUser): Promise<MandayPlanView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    const access = await this.access.requireCapability(
      actor.id,
      actor.role as Role,
      nodeId,
      'viewProject',
    );

    let plan = await this.prisma.mandayPlan.findUnique({
      where: { projectId },
      include: PLAN_INCLUDE,
    });

    if (!plan) {
      plan = await this.prisma.mandayPlan.create({
        data: {
          projectId,
          roles: DEFAULT_ROLES,
          createdById: actor.id,
          tasks: {
            // Seeded with the standard breakdown so the estimator fills numbers
            // in instead of retyping the same twenty rows for every project.
            create: DEFAULT_MANDAY_TASKS.map((task, index) => ({
              stage: task.stage as ProjectStage,
              name: task.name,
              position: index,
            })),
          },
        },
        include: PLAN_INCLUDE,
      });
    }

    return toView(plan, access.capabilities.createDocument, access.capabilities.manageProject);
  }

  /** Replaces the whole grid: rows are an ordering, saved as one. */
  async save(
    projectId: string,
    input: SaveMandayPlanInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<MandayPlanView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    const access = await this.access.requireCapability(
      actor.id,
      actor.role as Role,
      nodeId,
      'createDocument',
    );

    const current = await this.prisma.mandayPlan.findUnique({
      where: { projectId },
      select: { id: true, status: true, updatedAt: true },
    });
    if (!current) throw AppException.notFound('Manday plan');

    if (input.expectedUpdatedAt && current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw AppException.conflict(
        'Estimasi sudah diubah di tempat lain. Muat ulang halaman lalu ulangi perubahan Anda.',
      );
    }

    /*
     * Submitting locks the estimate, and the lock is enforced here rather than
     * only in `canEdit`.
     *
     * `canEdit` decides what the screen offers; this decides what the API
     * accepts. The Timeline schedules every task from these numbers, so an
     * estimate that kept moving after submission would leave a schedule
     * derived from figures nobody agreed to.
     */
    if (current.status === 'SUBMITTED') {
      throw AppException.conflict(
        'Estimasi sudah di-submit dan terkunci. Buka kembali dulu bila perlu diubah.',
      );
    }

    if (current.status === 'APPROVED') {
      throw AppException.conflict('Estimasi sudah disetujui, sehingga tidak bisa diubah.');
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      const keptIds = input.tasks
        .map((task) => task.id)
        .filter((taskId): taskId is string => Boolean(taskId));

      await tx.mandayTask.deleteMany({
        where: {
          planId: current.id,
          ...(keptIds.length > 0 ? { id: { notIn: keptIds } } : {}),
        },
      });

      // Position is per parent — or per stage for a top-level row — derived
      // from the order rows arrive in, so the payload never has to carry a
      // number the UI would have to keep correct.
      const counters = new Map<string, number>();

      /*
       * The editor's key for each row, mapped to the id it ended up with.
       *
       * A child and its parent can both be new in the same save, so a child
       * cannot name its parent by id. The rows arrive parent-first (the editor
       * flattens the tree depth-first), which is what lets one pass resolve
       * every link.
       */
      const idByKey = new Map<string, string>();

      for (const task of input.tasks) {
        const stage = task.stage as ProjectStage;
        const parentId = task.parentKey ? (idByKey.get(task.parentKey) ?? null) : null;

        const bucket = `${stage}:${parentId ?? 'root'}`;
        const position = counters.get(bucket) ?? 0;
        counters.set(bucket, position + 1);

        const efforts = Object.entries(task.efforts ?? {})
          .filter(([, days]) => typeof days === 'number')
          .map(([jobRole, days]) => ({
            jobRole: jobRole as ProjectJobRole,
            days: days as number,
          }));

        const data = {
          stage,
          name: task.name,
          position,
          parentId,
          status: task.status as MandayStatus,
        };

        let taskId = task.id ?? null;
        if (taskId) {
          const touched = await tx.mandayTask.updateMany({
            where: { id: taskId, planId: current.id },
            data,
          });
          if (touched.count === 0) taskId = null;
        }

        if (!taskId) {
          const created = await tx.mandayTask.create({
            data: { ...data, planId: current.id },
            select: { id: true },
          });
          taskId = created.id;
        }

        idByKey.set(task.key, taskId);

        // The cells are replaced wholesale: a role removed from the columns
        // must not leave its days behind to reappear if it is added back.
        await tx.mandayEffort.deleteMany({ where: { taskId } });
        if (efforts.length > 0) {
          await tx.mandayEffort.createMany({
            data: efforts.map((effort) => ({ taskId: taskId!, ...effort })),
          });
        }
      }

      return tx.mandayPlan.update({
        where: { id: current.id },
        data: {
          module: input.module,
          pic: input.pic,
          estimatedAt: input.estimatedAt ? new Date(input.estimatedAt) : null,
          roles: input.roles as ProjectJobRole[],
        },
        include: PLAN_INCLUDE,
      });
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.MANDAY_PLAN_SAVED,
      entity: 'MandayPlan',
      entityId: plan.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: { projectId, tasks: input.tasks.length, roles: input.roles },
    });

    return toView(plan, access.capabilities.createDocument, access.capabilities.manageProject);
  }

  /** Submit for approval, or record the decision on a submitted plan. */
  async decide(
    projectId: string,
    input: SubmitMandayPlanInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<MandayPlanView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);

    // Submitting is the estimator's act; approving is the manager's. Routing
    // both through one endpoint keeps the state machine in one place, but the
    // capability required differs per transition.
    const needed = input.status === 'SUBMITTED' ? 'createDocument' : 'manageProject';
    const access = await this.access.requireCapability(
      actor.id,
      actor.role as Role,
      nodeId,
      needed,
    );

    const current = await this.prisma.mandayPlan.findUnique({
      where: { projectId },
      select: { id: true, status: true },
    });
    if (!current) throw AppException.notFound('Manday plan');

    // Reopening: a decided estimate goes back to DRAFT so it can be corrected.
    // Without this, approval was a one-way door — a wrong figure, once agreed,
    // could never be revised, and the only way forward was a new project.
    if (input.status === 'DRAFT') {
      if (current.status !== 'APPROVED' && current.status !== 'REJECTED') {
        throw AppException.conflict(
          'Hanya estimasi yang sudah diputuskan yang bisa dibuka kembali.',
        );
      }
    } else if (input.status !== 'SUBMITTED' && current.status !== 'SUBMITTED') {
      // A decision still needs something submitted to decide on.
      throw AppException.conflict('Hanya estimasi yang sudah di-submit yang bisa diputuskan.');
    }

    const plan = await this.prisma.mandayPlan.update({
      where: { id: current.id },
      data: {
        status: input.status as MandayStatus,
        ...(input.status === 'SUBMITTED'
          ? { submittedAt: new Date(), submittedById: actor.id, decidedAt: null, decidedById: null }
          : input.status === 'DRAFT'
            ? // Back to the start: the previous decision no longer describes
              // this plan, so it is cleared rather than left to be misread as
              // an approval of whatever is edited next.
              {
                submittedAt: null,
                submittedById: null,
                decidedAt: null,
                decidedById: null,
                decisionNote: input.note,
              }
            : { decidedAt: new Date(), decidedById: actor.id, decisionNote: input.note }),
      },
      include: PLAN_INCLUDE,
    });

    await this.auditService.record({
      action:
        input.status === 'SUBMITTED'
          ? AUDIT_ACTIONS.MANDAY_PLAN_SUBMITTED
          : AUDIT_ACTIONS.MANDAY_PLAN_DECIDED,
      entity: 'MandayPlan',
      entityId: plan.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: { projectId, from: current.status, to: input.status },
    });

    await this.announce(plan, nodeId, input.status, input.note, actor);

    return toView(plan, access.capabilities.createDocument, access.capabilities.manageProject);
  }

  /**
   * Tells the people the transition concerns.
   *
   * Submitting reaches whoever manages the node — as news that the estimate is
   * in, not as a request for anything. A decision reaches whoever submitted.
   * Reopening a plan tells nobody: it is the estimator picking their own work
   * back up, and a notification for that is noise.
   *
   * `notify()` swallows its own failures, so a mail server having a bad minute
   * cannot undo the approval it was announcing.
   */
  private async announce(
    plan: PlanRow,
    nodeId: string,
    status: string,
    note: string | null,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const link = `/workspace/project/${plan.project.id}/mandays`;
    const where = `${plan.project.node.name} / ${plan.project.name}`;

    if (status === 'SUBMITTED') {
      const approvers = await this.access.listUsersWithCapability(nodeId, 'manageProject');

      await this.notifications.notify({
        kind: 'MANDAY_SUBMITTED',
        userIds: approvers,
        title: `Estimasi mandays di-submit — ${plan.project.name}`,
        body: `${actor.email} men-submit estimasi mandays di ${where}.`,
        link,
        entity: 'MandayPlan',
        entityId: plan.id,
        actorId: actor.id,
        actorName: actor.email,
        emailSubject: `[D-Trace] Estimasi mandays di-submit — ${plan.project.name}`,
      });
      return;
    }

    if (status !== 'APPROVED' && status !== 'REJECTED') return;

    // Back to whoever asked. `submittedById` is cleared on reopen, so this is
    // only ever the person whose submission is being answered.
    const submitter = plan.submittedById;
    if (!submitter) return;

    const approved = status === 'APPROVED';

    await this.notifications.notify({
      kind: approved ? 'MANDAY_APPROVED' : 'MANDAY_REJECTED',
      userIds: [submitter],
      title: `Estimasi mandays ${approved ? 'disetujui' : 'ditolak'} — ${plan.project.name}`,
      body: [`${actor.email} ${approved ? 'menyetujui' : 'menolak'} estimasi di ${where}.`, note]
        .filter(Boolean)
        .join(' ')
        .trim(),
      link,
      entity: 'MandayPlan',
      entityId: plan.id,
      actorId: actor.id,
      actorName: actor.email,
      emailSubject: `[D-Trace] Estimasi mandays ${approved ? 'disetujui' : 'ditolak'} — ${plan.project.name}`,
    });
  }
}

function toView(plan: PlanRow, canEdit: boolean, canApprove: boolean): MandayPlanView {
  const tasks: MandayTaskView[] = plan.tasks.map((task) => ({
    id: task.id,
    parentId: task.parentId,
    stage: task.stage as ProjectStage,
    name: task.name,
    position: task.position,
    status: task.status as MandayStatus,
    efforts: Object.fromEntries(
      // Prisma returns Decimal; the wire format is a plain number, because an
      // estimate in days never needs more precision than a float gives.
      task.efforts.map((effort) => [effort.jobRole, Number(effort.days)]),
    ) as MandayTaskView['efforts'],
  }));

  // Stage order comes from the shared constant, not from the enum's alphabet:
  // `DEFINE` sorts before `PREPARE` in SQL, which is not the order work happens.
  tasks.sort(
    (a, b) =>
      PROJECT_STAGES.indexOf(a.stage) - PROJECT_STAGES.indexOf(b.stage) || a.position - b.position,
  );

  return {
    id: plan.id,
    projectId: plan.project.id,
    projectName: plan.project.name,
    node: { id: plan.project.node.id, name: plan.project.node.name },
    createdAt: plan.createdAt.toISOString(),
    module: plan.module,
    pic: plan.pic,
    estimatedAt: plan.estimatedAt?.toISOString() ?? null,
    roles: plan.roles as ProjectJobRole[],
    status: plan.status as MandayStatus,
    tasks,
    submittedAt: plan.submittedAt?.toISOString() ?? null,
    decidedAt: plan.decidedAt?.toISOString() ?? null,
    decisionNote: plan.decisionNote,
    // Submitting leaves it editable: an estimate is revised after it is first
    // settled far more often than it is approved, and there is no screen in
    // the app that could unlock a plan that locked itself on submit.
    // Submitted is locked too, not just approved: submitting is the act that
    // hands these numbers to the Timeline.
    canEdit: canEdit && plan.status !== 'SUBMITTED' && plan.status !== 'APPROVED',
    canApprove,
    updatedAt: plan.updatedAt.toISOString(),
  };
}
