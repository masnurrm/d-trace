import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  resolveDocumentCapabilities,
  type AddProjectMemberInput,
  type DocumentAccessView,
  type DocumentCapabilities,
  type ProjectJobRole,
  type ProjectMemberView,
  type ProjectRole,
  type Role,
  type SetDocumentAccessInput,
  type UpdateProjectMemberInput,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

/**
 * The project team, and what each member may do with each document.
 *
 * Two layers, and the order between them is the whole design:
 *
 *  1. membership gives a **project role** — COLLABORATOR unless someone with
 *     authority raised it — which resolves to capabilities through the node
 *     grant and the permission matrix;
 *  2. a **document override** replaces that answer for one document.
 *
 * Replacement, not merging: a merge could only ever widen, and then "this
 * person may not open this document" would be impossible to express.
 */
@Injectable()
export class ProjectTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly auditService: AuditService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Membership                                                           */
  /* ------------------------------------------------------------------ */

  async listMembers(projectId: string, actor: AuthenticatedUser): Promise<ProjectMemberView[]> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'viewProject');

    const [members, nodeGrants] = await Promise.all([
      this.prisma.projectMember.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          userId: true,
          jobRole: true,
          projectRole: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
      // Whoever holds a grant on the node is already on this project whether or
      // not anyone added them; showing only the explicit list would hide half
      // the people who can open it.
      this.prisma.userNodeAccess.findMany({
        where: { nodeId, user: { isActive: true } },
        select: {
          userId: true,
          role: true,
          user: { select: { name: true, email: true } },
        },
      }),
    ]);

    const explicit = new Set(members.map((member) => member.userId));

    const fromTeam: ProjectMemberView[] = members.map((member) => ({
      id: member.id,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      jobRole: member.jobRole as ProjectJobRole,
      projectRole: member.projectRole as ProjectRole,
      fromNodeGrant: false,
      createdAt: member.createdAt.toISOString(),
    }));

    const fromNode: ProjectMemberView[] = nodeGrants
      .filter((grant) => !explicit.has(grant.userId))
      .map((grant) => ({
        // Synthetic id: there is no membership row to address, which is exactly
        // what `fromNodeGrant` tells the UI — remove is not offered for these.
        id: `node:${grant.userId}`,
        userId: grant.userId,
        name: grant.user.name,
        email: grant.user.email,
        jobRole: 'BA' as ProjectJobRole,
        projectRole: grant.role as ProjectRole,
        fromNodeGrant: true,
        createdAt: '',
      }));

    return [...fromTeam, ...fromNode];
  }

  async addMember(
    projectId: string,
    input: AddProjectMemberInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<ProjectMemberView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    const access = await this.access.requireCapability(
      actor.id,
      actor.role as Role,
      nodeId,
      'manageProject',
    );

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, name: true, email: true, isActive: true },
    });
    if (!user || !user.isActive) throw AppException.notFound('User');

    // Nobody hands out a role above their own. Without this an ADMIN-at-node
    // could be created by a Manager, which is a promotion by the back door.
    const projectRole = this.cappedRole(input.projectRole, access.role);

    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: input.userId } },
      select: { id: true },
    });
    if (existing) throw AppException.conflict('User ini sudah ada di tim project');

    const member = await this.prisma.projectMember.create({
      data: {
        projectId,
        userId: input.userId,
        jobRole: input.jobRole as ProjectJobRole,
        projectRole,
        addedById: actor.id,
      },
      select: { id: true, createdAt: true },
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.PROJECT_MEMBER_ADDED,
      entity: 'ProjectMember',
      entityId: member.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: { projectId, userId: input.userId, jobRole: input.jobRole, projectRole },
    });

    return {
      id: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      jobRole: input.jobRole as ProjectJobRole,
      projectRole,
      fromNodeGrant: false,
      createdAt: member.createdAt.toISOString(),
    };
  }

  async updateMember(
    projectId: string,
    memberId: string,
    input: UpdateProjectMemberInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<void> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    const access = await this.access.requireCapability(
      actor.id,
      actor.role as Role,
      nodeId,
      'manageProject',
    );

    const updated = await this.prisma.projectMember.updateMany({
      // Scoped by projectId: a member id from another project must not become
      // an editing primitive for the project this request names.
      where: { id: memberId, projectId },
      data: {
        ...(input.jobRole !== undefined ? { jobRole: input.jobRole as ProjectJobRole } : {}),
        ...(input.projectRole !== undefined
          ? { projectRole: this.cappedRole(input.projectRole, access.role) }
          : {}),
      },
    });
    if (updated.count === 0) throw AppException.notFound('Project member');

    await this.auditService.record({
      action: AUDIT_ACTIONS.PROJECT_MEMBER_UPDATED,
      entity: 'ProjectMember',
      entityId: memberId,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: { projectId, changes: input },
    });
  }

  async removeMember(
    projectId: string,
    memberId: string,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<void> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'manageProject');

    const removed = await this.prisma.projectMember.deleteMany({
      where: { id: memberId, projectId },
    });
    if (removed.count === 0) throw AppException.notFound('Project member');

    await this.auditService.record({
      action: AUDIT_ACTIONS.PROJECT_MEMBER_REMOVED,
      entity: 'ProjectMember',
      entityId: memberId,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: { projectId },
    });
  }

  /**
   * People who could be added to this team.
   *
   * A separate endpoint from  on purpose: that one is the Admin Panel's
   * account list and is AUDITOR-gated, while a project Manager who is not an
   * auditor still has to be able to staff their own team. This returns names
   * and emails only — enough to pick someone, nothing more.
   */
  /**
   * Accounts not yet on this team, a page at a time.
   *
   * Paged because the picker scrolls rather than loading everyone: an install
   * with a few thousand accounts would otherwise ship all of them to render
   * ten. One extra row is fetched and dropped — that is how the caller learns
   * there is more without a second count query.
   */
  async listCandidates(
    projectId: string,
    actor: AuthenticatedUser,
    search: string | undefined,
    page = 1,
    limit = 10,
  ): Promise<{ items: { id: string; name: string; email: string }[]; hasNext: boolean }> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'manageProject');

    const existing = await this.prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true },
    });
    const taken = existing.map((member) => member.userId);

    const rows = await this.prisma.user.findMany({
      where: {
        isActive: true,
        ...(taken.length > 0 ? { id: { notIn: taken } } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
      skip: (Math.max(1, page) - 1) * limit,
      take: limit + 1,
    });

    return { items: rows.slice(0, limit), hasNext: rows.length > limit };
  }

  /* ------------------------------------------------------------------ */
  /* Per-document access                                                  */
  /* ------------------------------------------------------------------ */

  /** The access list for one document: every member, with any override applied. */
  async documentAccess(
    documentId: string,
    actor: AuthenticatedUser,
  ): Promise<DocumentAccessView[]> {
    const nodeId = await this.access.nodeIdOfDocument(documentId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'manageProject');

    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { projectId: true },
    });

    const [members, overrides] = await Promise.all([
      this.listMembers(document.projectId, actor),
      this.prisma.documentPermission.findMany({ where: { documentId } }),
    ]);

    const byUser = new Map(overrides.map((row) => [row.userId, row]));

    return members.map((member) => {
      const override = byUser.get(member.userId) ?? null;
      const inherited = inheritedCapabilities(member.projectRole);
      const resolved = resolveDocumentCapabilities(inherited, override);

      return {
        userId: member.userId,
        name: member.name,
        email: member.email,
        jobRole: member.jobRole,
        projectRole: member.projectRole,
        canView: resolved.view,
        canCreate: resolved.create,
        canEdit: resolved.edit,
        canDelete: resolved.delete,
        isOverride: override !== null,
        inherited,
      } satisfies DocumentAccessView;
    });
  }

  /**
   * Replaces the override list for one document.
   *
   * An entry that matches what the member's role already implies is *not*
   * stored: keeping it would turn a later change of role into a silent no-op
   * for that person, which is the kind of stale permission nobody thinks to
   * look for.
   */
  async setDocumentAccess(
    documentId: string,
    input: SetDocumentAccessInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<DocumentAccessView[]> {
    const nodeId = await this.access.nodeIdOfDocument(documentId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'manageProject');

    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { projectId: true },
    });
    const members = await this.listMembers(document.projectId, actor);
    const roleByUser = new Map(members.map((member) => [member.userId, member.projectRole]));

    const meaningful = input.entries.filter((entry) => {
      const projectRole = roleByUser.get(entry.userId);
      if (!projectRole) return false;

      const inherited = inheritedCapabilities(projectRole);
      return (
        inherited.view !== entry.canView ||
        inherited.create !== entry.canCreate ||
        inherited.edit !== entry.canEdit ||
        inherited.delete !== entry.canDelete
      );
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.documentPermission.deleteMany({ where: { documentId } });
      if (meaningful.length > 0) {
        await tx.documentPermission.createMany({
          data: meaningful.map((entry) => ({
            documentId,
            userId: entry.userId,
            canView: entry.canView,
            canCreate: entry.canCreate,
            canEdit: entry.canEdit,
            canDelete: entry.canDelete,
            updatedById: actor.id,
          })),
        });
      }
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.DOCUMENT_ACCESS_CHANGED,
      entity: 'Document',
      entityId: documentId,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: {
        overrides: meaningful.length,
        restricted: meaningful.filter((entry) => !entry.canView).map((entry) => entry.userId),
      },
    });

    return this.documentAccess(documentId, actor);
  }

  /** Whether this user is explicitly barred from one document. */
  async isRestricted(userId: string, documentId: string): Promise<boolean> {
    const row = await this.prisma.documentPermission.findUnique({
      where: { documentId_userId: { documentId, userId } },
      select: { canView: true },
    });
    return row !== null && !row.canView;
  }

  /** Document ids this user is explicitly barred from. Used to filter lists. */
  async restrictedDocumentIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.documentPermission.findMany({
      where: { userId, canView: false },
      select: { documentId: true },
    });
    return rows.map((row) => row.documentId);
  }

  /** A role is never raised above the one held by whoever is granting it. */
  private cappedRole(requested: ProjectRole, actorRole: ProjectRole): ProjectRole {
    const rank: Record<ProjectRole, number> = {
      VIEWER: 0,
      COLLABORATOR: 10,
      MANAGER: 20,
      ADMIN: 30,
    };
    return rank[requested] > rank[actorRole] ? actorRole : requested;
  }
}

/**
 * What a project role implies for a document before any override.
 *
 * Kept deliberately coarse — the fine-grained answer is the permission matrix,
 * and this is only the baseline an override is compared against so that a
 * no-op override never gets stored.
 */
function inheritedCapabilities(projectRole: ProjectRole): DocumentCapabilities {
  switch (projectRole) {
    case 'ADMIN':
    case 'MANAGER':
      return { view: true, create: true, edit: true, delete: true };
    case 'COLLABORATOR':
      return { view: true, create: true, edit: true, delete: false };
    case 'VIEWER':
      return { view: true, create: false, edit: false, delete: false };
  }
}
