import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  bugCode,
  reachedEnvironment,
  type BugEnvironment,
  type BugSeverity,
  type BugStatus,
  type BugView,
  type ProjectBugsView,
  type ProjectStage,
  type ProjectStatus,
  type Role,
  type SaveBugInput,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

const BUG_INCLUDE = {
  developer: { select: { name: true } },
  qa: { select: { name: true } },
  reportedBy: { select: { name: true } },
} satisfies Prisma.ProjectBugInclude;

type BugRow = Prisma.ProjectBugGetPayload<{ include: typeof BUG_INCLUDE }>;

/** The whole bug, on both sides of a change, minus the joined names. */
const AUDIT_SELECT = {
  id: true,
  projectId: true,
  number: true,
  title: true,
  description: true,
  module: true,
  environment: true,
  severity: true,
  status: true,
  developerId: true,
  qaId: true,
  foundAt: true,
  fixEta: true,
  readyForTestAt: true,
  resolvedAt: true,
  reportedById: true,
  deletedAt: true,
} satisfies Prisma.ProjectBugSelect;

type AuditRow = Prisma.ProjectBugGetPayload<{ select: typeof AUDIT_SELECT }>;

/** How many times a report retries when another one took its number first. */
const NUMBER_ATTEMPTS = 5;

/**
 * The Bug & Issue list of a project.
 *
 * Returned whole, like the task list: a project has tens of bugs, and the
 * screen filters, groups, counts and exports across all of them at once. The
 * ceiling is there so one runaway import cannot take the screen down, not
 * because anyone expects to reach it.
 *
 * Permissions are the ISSUE rows of the Role & Akses matrix — view, create,
 * update, delete — so who may report and who may close a bug is a setting a
 * node's admin can change, not a rule in this file.
 */
@Injectable()
export class BugService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
  ) {}

  async listForProject(projectId: string, actor: AuthenticatedUser): Promise<ProjectBugsView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'viewIssue');

    const [rows, project, uatScript] = await Promise.all([
      this.prisma.projectBug.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { number: 'asc' },
        include: BUG_INCLUDE,
        take: 1000,
      }),
      this.prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: {
          stage: true,
          status: true,
          implementationPlan: { select: { firstCompletedAt: true } },
        },
      }),
      this.prisma.testScript.findUnique({
        where: { projectId_kind: { projectId, kind: 'UAT' } },
        select: { id: true },
      }),
    ]);

    const reached = reachedEnvironment({
      implementationCompletedAt:
        project.implementationPlan?.firstCompletedAt?.toISOString() ?? null,
      stage: project.stage as ProjectStage,
      status: project.status as ProjectStatus,
      uatStarted: uatScript !== null,
      bugEnvironments: [...new Set(rows.map((row) => row.environment as BugEnvironment))],
    });

    return {
      bugs: rows.map(toView),
      environment: reached.environment,
      environmentReason: reached.reason,
    };
  }

  async create(
    projectId: string,
    input: SaveBugInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<BugView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'createIssue');
    await this.assertOnTeam(projectId, input, null);

    const row = await this.insertNumbered(projectId, {
      ...toData(input),
      ...stamps(null, input.status, new Date()),
      reportedById: actor.id,
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.PROJECT_BUG_CREATED,
      entity: 'ProjectBug',
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
    input: SaveBugInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<BugView> {
    const before = await this.findLive(id);

    const nodeId = await this.access.nodeIdOfProject(before.projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'updateIssue');
    await this.assertOnTeam(before.projectId, input, before);

    const row = await this.prisma.projectBug.update({
      where: { id },
      data: { ...toData(input), ...stamps(before, input.status, new Date()) },
      include: BUG_INCLUDE,
    });

    await this.recordUpdate(before, row, actor, client);
    return toView(row);
  }

  /**
   * A status move on its own.
   *
   * Separate from `update` so the board's one-click buttons send one field:
   * replacing the whole bug from a row that was rendered a minute ago would
   * quietly undo whatever somebody else edited in that minute.
   */
  async updateStatus(
    id: string,
    status: BugStatus,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<BugView> {
    const before = await this.findLive(id);

    const nodeId = await this.access.nodeIdOfProject(before.projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'updateIssue');

    const row = await this.prisma.projectBug.update({
      where: { id },
      data: { status, ...stamps(before, status, new Date()) },
      include: BUG_INCLUDE,
    });

    await this.recordUpdate(before, row, actor, client);
    return toView(row);
  }

  /**
   * A soft delete: the bug leaves the list but keeps its row, and with it its
   * number. Numbers are handed out past deleted rows too, so a code people
   * already quoted never comes back meaning something else.
   */
  async remove(id: string, actor: AuthenticatedUser, client: ClientInfo): Promise<void> {
    const before = await this.findLive(id);

    const nodeId = await this.access.nodeIdOfProject(before.projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'deleteIssue');

    const after = await this.prisma.projectBug.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: AUDIT_SELECT,
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.PROJECT_BUG_DELETED,
      entity: 'ProjectBug',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before,
      after,
    });
  }

  /** A bug that is still listed, in a project that still exists. */
  private async findLive(id: string): Promise<AuditRow> {
    const row = await this.prisma.projectBug.findFirst({
      where: { id, deletedAt: null, project: { deletedAt: null } },
      select: AUDIT_SELECT,
    });
    if (!row) throw AppException.notFound('Bug');
    return row;
  }

  /**
   * Inserts with the next number in the project.
   *
   * "One past the highest", deleted rows included. Two reports landing in the
   * same instant both read the same highest; the unique index turns the later
   * one into P2002 and it simply reads again, rather than a lock serialising
   * every report on the project for the sake of a collision that almost never
   * happens.
   */
  private async insertNumbered(
    projectId: string,
    data: Omit<Prisma.ProjectBugUncheckedCreateInput, 'projectId' | 'number'>,
  ): Promise<BugRow> {
    for (let attempt = 1; ; attempt += 1) {
      const last = await this.prisma.projectBug.findFirst({
        where: { projectId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });

      try {
        return await this.prisma.projectBug.create({
          data: { ...data, projectId, number: (last?.number ?? 0) + 1 },
          include: BUG_INCLUDE,
        });
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002' || attempt >= NUMBER_ATTEMPTS) throw error;
      }
    }
  }

  /**
   * The developer and the QA must be on the project's team.
   *
   * Without this a bug could name anybody on the platform, and its view would
   * hand back their name to whoever asked. Somebody already on the bug passes
   * even after leaving the team: fixing a typo in the title must not fail
   * because of who fixed the bug last month.
   */
  private async assertOnTeam(
    projectId: string,
    input: Pick<SaveBugInput, 'developerId' | 'qaId'>,
    before: Pick<AuditRow, 'developerId' | 'qaId'> | null,
  ): Promise<void> {
    const fields = (['developerId', 'qaId'] as const).filter(
      (field) => input[field] !== null && input[field] !== before?.[field],
    );
    if (fields.length === 0) return;

    const members = await this.prisma.projectMember.findMany({
      where: { projectId, userId: { in: fields.map((field) => input[field] as string) } },
      select: { userId: true },
    });
    const onTeam = new Set(members.map((member) => member.userId));

    const outsiders = fields.filter((field) => !onTeam.has(input[field] as string));
    if (outsiders.length > 0) {
      throw AppException.validation(
        outsiders.map((field) => ({ field, message: 'Bukan anggota tim project ini' })),
      );
    }
  }

  private async recordUpdate(
    before: AuditRow,
    row: BugRow,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<void> {
    await this.audit.record({
      action: AUDIT_ACTIONS.PROJECT_BUG_UPDATED,
      entity: 'ProjectBug',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before,
      after: pickAudit(row),
    });
  }
}

const toDate = (value: string | null) => (value ? new Date(value) : null);

function toData(input: SaveBugInput) {
  return {
    title: input.title,
    description: input.description,
    module: input.module,
    environment: input.environment as BugEnvironment,
    severity: input.severity as BugSeverity,
    status: input.status as BugStatus,
    developerId: input.developerId,
    qaId: input.qaId,
    foundAt: new Date(input.foundAt),
    fixEta: toDate(input.fixEta),
  };
}

/**
 * The two timestamps a status move decides.
 *
 * `readyForTestAt` is the latest handover to QA: stamped afresh each time the
 * bug enters Pending to Test, cleared when it goes back to the developer, and
 * stamped on arrival in QA if it got there without a handover. `resolvedAt` is
 * when it reached Done, kept while it stays there and cleared if it is
 * reopened — a reopened bug is not resolved, whatever it was last week.
 */
function stamps(
  before: Pick<AuditRow, 'status' | 'readyForTestAt' | 'resolvedAt'> | null,
  next: BugStatus,
  now: Date,
): { readyForTestAt: Date | null; resolvedAt: Date | null } {
  const previous = before?.status ?? null;

  let readyForTestAt = before?.readyForTestAt ?? null;
  if (next === 'OPEN' || next === 'IN_PROGRESS') readyForTestAt = null;
  else if (next === 'PENDING_TEST' && previous !== 'PENDING_TEST') readyForTestAt = now;
  else if (next === 'IN_QA' && readyForTestAt === null) readyForTestAt = now;

  const resolvedAt =
    next !== 'DONE' ? null : previous === 'DONE' ? (before?.resolvedAt ?? now) : now;

  return { readyForTestAt, resolvedAt };
}

function pickAudit(row: BugRow): AuditRow {
  return Object.fromEntries(
    Object.keys(AUDIT_SELECT).map((key) => [key, row[key as keyof BugRow]]),
  ) as AuditRow;
}

function toView(row: BugRow): BugView {
  return {
    id: row.id,
    projectId: row.projectId,
    number: row.number,
    code: bugCode(row.number),
    title: row.title,
    description: row.description,
    module: row.module,
    environment: row.environment as BugEnvironment,
    severity: row.severity as BugSeverity,
    status: row.status as BugStatus,
    developerId: row.developerId,
    developerName: row.developer?.name ?? null,
    qaId: row.qaId,
    qaName: row.qa?.name ?? null,
    reportedByName: row.reportedBy?.name ?? null,
    foundAt: row.foundAt.toISOString(),
    fixEta: row.fixEta?.toISOString() ?? null,
    readyForTestAt: row.readyForTestAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
