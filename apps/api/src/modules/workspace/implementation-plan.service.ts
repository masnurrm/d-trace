import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  DEFAULT_IMPLEMENTATION_PLAN,
  DEFAULT_IMPLEMENTATION_START,
  summarizeImplementationPlan,
  type ImplementationHostView,
  type ImplementationPhaseView,
  type ImplementationPlanStatus,
  type ImplementationPlanView,
  type ImplementationStepView,
  type Role,
  type SaveImplementationPlanInput,
} from '@dtrace/shared';
import { randomUUID } from 'node:crypto';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import { ProjectStageService } from './project-stage.service.js';

/** The whole plan row, on both sides of a save. */
const AUDIT_SELECT = {
  id: true,
  projectId: true,
  serviceName: true,
  implementationDate: true,
  startTime: true,
  hosts: true,
  content: true,
  status: true,
  completedAt: true,
  completedById: true,
  firstCompletedAt: true,
} satisfies Prisma.ImplementationPlanSelect;

/**
 * The implementation plan of a project.
 *
 * Reading needs `viewProject`; writing needs `createDocument`, the same bar as
 * the test scripts — whoever may add a document to the project may record how
 * its cut-over went.
 */
@Injectable()
export class ImplementationPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    private readonly projectStage: ProjectStageService,
  ) {}

  async get(projectId: string, actor: AuthenticatedUser): Promise<ImplementationPlanView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'viewProject');

    const row = await this.prisma.implementationPlan.findUnique({ where: { projectId } });

    if (!row) {
      // Not written until the first save: opening a plan is not a change to
      // the project, and a row per visit would put noise in the audit trail.
      // Ids are minted per request, so an unsaved plan is the standard runbook
      // afresh each time rather than a shared object anybody could mutate.
      return {
        projectId,
        serviceName: DEFAULT_IMPLEMENTATION_PLAN.serviceName,
        implementationDate: null,
        startTime: DEFAULT_IMPLEMENTATION_START,
        hosts: DEFAULT_IMPLEMENTATION_PLAN.hosts.map((host) => ({ id: randomUUID(), ...host })),
        phases: DEFAULT_IMPLEMENTATION_PLAN.phases.map((phase) => ({
          id: randomUUID(),
          name: phase.name,
          steps: phase.steps.map((step) => ({
            ...blankStep(),
            ...step,
            note: step.note ?? '',
          })),
        })),
        status: 'DRAFT',
        completedAt: null,
        completedByName: null,
        updatedAt: null,
      };
    }

    return this.toView(row);
  }

  async save(
    projectId: string,
    input: SaveImplementationPlanInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<ImplementationPlanView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'createDocument');

    const before = await this.prisma.implementationPlan.findUnique({
      where: { projectId },
      select: { ...AUDIT_SELECT, updatedAt: true },
    });

    // `!== undefined`, not truthiness: `null` is the caller saying "I loaded a
    // plan that had never been saved", which is still a claim.
    if (input.expectedUpdatedAt !== undefined) {
      const current = before?.updatedAt.toISOString() ?? null;
      if (current !== input.expectedUpdatedAt) {
        throw AppException.conflict(
          'Implementation plan sudah diubah di tempat lain. Muat ulang halaman lalu ulangi perubahan Anda.',
        );
      }
    }

    if (input.complete) {
      const summary = summarizeImplementationPlan(input.phases);
      if (summary.total === 0) {
        throw AppException.validation([
          { field: 'phases', message: 'Belum ada aktivitas untuk ditandai selesai' },
        ]);
      }
      const open = summary.total - summary.settled;
      if (open > 0) {
        throw AppException.validation([
          {
            field: 'phases',
            message: `Masih ada ${open} aktivitas yang belum Done atau Skipped.`,
          },
        ]);
      }
    }

    // Any save that is not a completion returns the plan to Draft: what was
    // marked finished is no longer what is on the page, and a "selesai" badge
    // over steps that have since changed would be a claim nobody made.
    const status: ImplementationPlanStatus = input.complete ? 'COMPLETED' : 'DRAFT';
    const now = new Date();
    const data = {
      serviceName: input.serviceName,
      implementationDate: input.implementationDate
        ? new Date(`${input.implementationDate}T00:00:00.000Z`)
        : null,
      startTime: input.startTime,
      hosts: input.hosts as unknown as Prisma.InputJsonValue,
      content: input.phases as unknown as Prisma.InputJsonValue,
      status,
      completedAt: input.complete ? now : null,
      completedById: input.complete ? actor.id : null,
      // Once only. The Draft above undoes "finished"; nothing undoes "went live".
      ...(input.complete && !before?.firstCompletedAt ? { firstCompletedAt: now } : {}),
      updatedById: actor.id,
    };

    const row = await this.prisma.implementationPlan.upsert({
      where: { projectId },
      create: { projectId, ...data },
      update: data,
    });

    await this.audit.record({
      action: input.complete
        ? AUDIT_ACTIONS.IMPLEMENTATION_PLAN_COMPLETED
        : AUDIT_ACTIONS.IMPLEMENTATION_PLAN_SAVED,
      entity: 'ImplementationPlan',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: before ? pickAudit(before) : undefined,
      after: pickAudit(row),
    });

    await this.projectStage.sync(projectId);

    return this.toView(row);
  }

  private async nameOf(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return user?.name ?? null;
  }

  private async toView(row: {
    projectId: string;
    serviceName: string;
    implementationDate: Date | null;
    startTime: string;
    hosts: Prisma.JsonValue;
    content: Prisma.JsonValue;
    status: string;
    completedAt: Date | null;
    completedById: string | null;
    updatedAt: Date;
  }): Promise<ImplementationPlanView> {
    return {
      projectId: row.projectId,
      serviceName: row.serviceName,
      implementationDate: row.implementationDate
        ? row.implementationDate.toISOString().slice(0, 10)
        : null,
      startTime: row.startTime,
      hosts: (Array.isArray(row.hosts) ? row.hosts : []) as unknown as ImplementationHostView[],
      phases: (Array.isArray(row.content)
        ? row.content
        : []) as unknown as ImplementationPhaseView[],
      status: row.status as ImplementationPlanStatus,
      completedAt: row.completedAt?.toISOString() ?? null,
      completedByName: await this.nameOf(row.completedById),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** An empty phase still shows one row to type into, not a blank band. */
function blankStep(): ImplementationStepView {
  return {
    id: randomUUID(),
    activity: '',
    host: '',
    downtime: false,
    pic: '',
    durationMinutes: 5,
    estimatedStartTime: null,
    estimatedEndTime: null,
    actualStartedAt: null,
    actualFinishedAt: null,
    actualDurationMinutes: null,
    status: 'NOT_STARTED',
    note: '',
  };
}

function pickAudit(row: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(AUDIT_SELECT).map((key) => [key, row[key]]));
}
