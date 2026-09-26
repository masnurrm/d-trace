import { Injectable } from '@nestjs/common';
import {
  ROLES,
  resolveNodeCapabilities,
  type NodeCapabilities,
  type ProjectRole,
  type Role,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** One node the caller can reach, with the grant already resolved. */
export interface ResolvedNodeAccess {
  nodeId: string;
  role: ProjectRole;
  capabilities: NodeCapabilities;
}

/**
 * Who may reach which node, and as what.
 *
 * Every workspace read and write funnels through here, so "can this person do
 * this?" is answered once from one place: the node grant in `UserNodeAccess`,
 * resolved against the permission matrix the Role & Akses screen owns. A
 * handler that checked the grant itself would eventually disagree with the
 * sidebar about what to offer, and a menu that offers what the API refuses is
 * worse than no menu.
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
  ) {}

  /**
   * The nodes this caller can reach **and can hold work**.
   *
   * Only the bottom of the hierarchy qualifies. `AGIT`, `Manage Service`,
   * `ASMO3` and `IAMI` are containers — they describe where an organisation
   * sits, not where a project is run — and offering a "+" on them would invite
   * a project nobody could place sensibly. Projects live in an App: `ESS-HR`,
   * `ESS-Budget`, `ESS-IT`.
   *
   * Which level that is comes from the node-type grammar rather than from a
   * hardcoded code, so an organisation that adds a level below App gets the
   * right answer without a release. See `projectNodeIds()`.
   *
   * A SUPER_ADMIN reaches every such node as a project ADMIN. That is not a
   * back door: the platform operator already administers the hierarchy itself,
   * so requiring them to grant themselves access to each node would be
   * ceremony that the very next screen lets them perform anyway.
   */
  async listAccessibleNodes(
    userId: string,
    systemRole: Role,
  ): Promise<ResolvedNodeAccess[]> {
    const [{ matrix }, projectNodes] = await Promise.all([
      this.permissionsService.get(),
      this.projectNodeIds(),
    ]);

    if (systemRole === ROLES.SUPER_ADMIN) {
      const nodes = await this.prisma.node.findMany({
        where: { isActive: true, id: { in: [...projectNodes] } },
        select: { id: true },
      });
      return nodes.map((node) => ({
        nodeId: node.id,
        role: 'ADMIN' as ProjectRole,
        capabilities: resolveNodeCapabilities(matrix, 'ADMIN', true),
      }));
    }

    const grants = await this.prisma.userNodeAccess.findMany({
      where: { userId, node: { isActive: true } },
      select: { nodeId: true, role: true, canCreateDocument: true },
    });

    return grants
      // A grant on a container is still a real grant — the access form writes
      // one row per node it ticked — but it is not a place to put a project,
      // so it does not become an entry in the Workspace.
      .filter((grant) => projectNodes.has(grant.nodeId))
      .map((grant) => ({
        nodeId: grant.nodeId,
        role: grant.role as ProjectRole,
        capabilities: resolveNodeCapabilities(
          matrix,
          grant.role as ProjectRole,
          grant.canCreateDocument,
        ),
      }));
  }

  /**
   * Node ids that may hold projects.
   *
   * A node qualifies when its **type admits no children**: nothing in the
   * grammar may be placed under it, so it is the bottom of the tree by
   * declaration rather than by accident of what has been created so far. That
   * distinction matters — an App with no children yet and a Department with no
   * children yet look identical in the node table, and only the type says
   * which one is a leaf on purpose.
   *
   * A node that already holds projects is included regardless. If someone
   * later declares a type below App, those projects must not vanish from the
   * sidebar; hiding existing work is a worse failure than showing one extra
   * node.
   */
  private async projectNodeIds(): Promise<Set<string>> {
    const [leafTypes, nodesWithProjects] = await Promise.all([
      this.prisma.nodeType.findMany({
        select: { id: true, _count: { select: { allowedChildren: true } } },
      }),
      this.prisma.project.findMany({
        where: { deletedAt: null },
        select: { nodeId: true },
        distinct: ['nodeId'],
      }),
    ]);

    const leafTypeIds = leafTypes
      .filter((type) => type._count.allowedChildren === 0)
      .map((type) => type.id);

    const leafNodes = await this.prisma.node.findMany({
      where: { typeId: { in: leafTypeIds } },
      select: { id: true },
    });

    return new Set([
      ...leafNodes.map((node) => node.id),
      ...nodesWithProjects.map((project) => project.nodeId),
    ]);
  }

  /** The grant for one node, or null when the caller has none there. */
  async accessForNode(
    userId: string,
    systemRole: Role,
    nodeId: string,
  ): Promise<ResolvedNodeAccess | null> {
    const nodes = await this.listAccessibleNodes(userId, systemRole);
    return nodes.find((node) => node.nodeId === nodeId) ?? null;
  }

  /**
   * Asserts a capability at a node.
   *
   * No access at all is a 404, not a 403: telling a caller "that exists but is
   * not yours" leaks the shape of an organisation they were never shown. A
   * caller who *can* see the node but lacks the specific capability gets a 403,
   * because at that point the node's existence is not a secret from them.
   */
  async requireCapability(
    userId: string,
    systemRole: Role,
    nodeId: string,
    capability: keyof NodeCapabilities,
  ): Promise<ResolvedNodeAccess> {
    const access = await this.accessForNode(userId, systemRole, nodeId);
    if (!access || !access.capabilities.viewProject) throw AppException.notFound('Node');

    if (!access.capabilities[capability]) {
      throw AppException.forbidden('Anda tidak punya izin untuk tindakan ini di node tersebut');
    }

    return access;
  }

  /**
   * Everyone who holds a capability at a node — the reverse of the lookup
   * above, which answers for one person at a time.
   *
   * Used to address a notification. Super admins are included because they can
   * reach every node as a project ADMIN, so leaving them out would mean an
   * approval request nobody was told about on a node with no local manager.
   */
  async listUsersWithCapability(
    nodeId: string,
    capability: keyof NodeCapabilities,
  ): Promise<string[]> {
    const { matrix } = await this.permissionsService.get();

    const [grants, operators] = await Promise.all([
      this.prisma.userNodeAccess.findMany({
        where: { nodeId, user: { isActive: true } },
        select: { userId: true, role: true, canCreateDocument: true },
      }),
      this.prisma.user.findMany({
        where: { role: ROLES.SUPER_ADMIN, isActive: true },
        select: { id: true },
      }),
    ]);

    const granted = grants
      .filter(
        (grant) =>
          resolveNodeCapabilities(matrix, grant.role as ProjectRole, grant.canCreateDocument)[
            capability
          ],
      )
      .map((grant) => grant.userId);

    return [...new Set([...granted, ...operators.map((user) => user.id)])];
  }

  /** The node a project sits in, or a 404 when the project does not exist. */
  async nodeIdOfProject(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
      select: { nodeId: true },
    });
    if (!project) throw AppException.notFound('Project');
    return project.nodeId;
  }

  /** The node a document sits in, following project → node. */
  async nodeIdOfDocument(documentId: string): Promise<string> {
    const document = await this.prisma.document.findFirst({
      // A document in a deleted project is gone with it.
      where: { id: documentId, deletedAt: null, project: { deletedAt: null } },
      select: { project: { select: { nodeId: true } } },
    });
    if (!document) throw AppException.notFound('Document');
    return document.project.nodeId;
  }
}
