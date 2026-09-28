import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  DEFAULT_PROJECT_DOCUMENTS,
  type DocumentScreen,
  computeProgress,
  type CreateDocumentInput,
  type CreateProjectInput,
  type DocumentStatus,
  type ListDocumentsQuery,
  type PaginationMeta,
  type ProjectStage,
  type ProjectStatus,
  type ProjectView,
  type Role,
  type UpdateDocumentInput,
  type UpdateProjectInput,
  type WorkspaceDocumentSummary,
  type WorkspaceNode,
  type WorkspaceTree,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { paginate } from '../../common/utils/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ProjectTeamService } from './project-team.service.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import { ProjectStageService } from './project-stage.service.js';

const SORTABLE_FIELDS = ['updatedAt', 'createdAt', 'title', 'status', 'stage'] as const;

const DOCUMENT_SELECT = {
  id: true,
  title: true,
  screen: true,
  template: { select: { code: true } },
  stage: true,
  status: true,
  ownerName: true,
  updatedAt: true,
  // Selected so a withdrawal has something to show as the field that moved.
  deletedAt: true,
  projectId: true,
  project: {
    select: {
      id: true,
      name: true,
      nodeId: true,
      node: { select: { id: true, name: true, parentId: true } },
    },
  },
} satisfies Prisma.DocumentSelect;

type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;

/** The projection a project deletion is audited in, the same on both sides. */
const PROJECT_DELETE_SELECT = {
  id: true,
  nodeId: true,
  name: true,
  code: true,
  createdById: true,
  deletedAt: true,
} satisfies Prisma.ProjectSelect;

/**
 * The Workspace: nodes a person can reach, the projects inside them, and the
 * documents inside those.
 *
 * Every read starts from the caller's node grants rather than from the object
 * being asked for. A query that began at the document and then checked access
 * would have to remember the check at each of a dozen call sites; starting
 * from the grant means an unreachable document is simply not in the result
 * set, and forgetting to filter is not a mistake that can be made.
 */
@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly team: ProjectTeamService,
    private readonly auditService: AuditService,
    private readonly projectStage: ProjectStageService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* The sidebar tree                                                     */
  /* ------------------------------------------------------------------ */

  async tree(actor: AuthenticatedUser): Promise<WorkspaceTree> {
    const grants = await this.access.listAccessibleNodes(actor.id, actor.role as Role);
    const visible = grants.filter((grant) => grant.capabilities.viewProject);
    if (visible.length === 0) {
      return { nodes: [], isPlatformOperator: actor.role === 'SUPER_ADMIN' };
    }

    const nodeIds = visible.map((grant) => grant.nodeId);

    const [nodes, projects, favouriteIds, ancestry] = await Promise.all([
      this.prisma.node.findMany({
        where: { id: { in: nodeIds } },
        select: { id: true, name: true, code: true, parentId: true },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.project.findMany({
        where: { nodeId: { in: nodeIds }, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          code: true,
          stage: true,
          status: true,
          nodeId: true,
          updatedAt: true,
          documents: {
            where: { deletedAt: null },
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            select: DOCUMENT_SELECT,
          },
        },
      }),
      this.favouriteIds(actor.id),
      this.ancestorNames(),
    ]);

    // A document the caller is explicitly barred from leaves the tree entirely.
    // Greying it out would still disclose that it exists, which is exactly what
    // a restriction is meant to prevent.
    const restricted = new Set(await this.team.restrictedDocumentIds(actor.id));

    const byNode = new Map(nodes.map((node) => [node.id, node]));

    const result: WorkspaceNode[] = visible
      .map((grant) => {
        const node = byNode.get(grant.nodeId);
        if (!node) return null;

        const nodeProjects = projects
          .filter((project) => project.nodeId === grant.nodeId)
          .map((project) => ({
            id: project.id,
            name: project.name,
            code: project.code,
            stage: project.stage as ProjectStage,
            status: project.status as ProjectStatus,
            documentCount: project.documents.filter((document) => !restricted.has(document.id))
              .length,
            updatedAt: project.updatedAt.toISOString(),
            // Documents hang under their project in the sidebar as well as in
            // the Project Space: the tree is how people navigate to one
            // directly, without first opening the project that holds it.
            documents: project.documents
              .filter((document) => !restricted.has(document.id))
              .map((document) => toDocumentSummary(document, favouriteIds, ancestry)),
          }));

        return {
          id: node.id,
          name: node.name,
          code: node.code,
          path: ancestry.get(node.id) ?? [],
          role: grant.role,
          capabilities: grant.capabilities,
          projects: nodeProjects,
        } satisfies WorkspaceNode;
      })
      .filter((node): node is WorkspaceNode => node !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

    return { nodes: result, isPlatformOperator: actor.role === 'SUPER_ADMIN' };
  }

  /* ------------------------------------------------------------------ */
  /* Documents                                                            */
  /* ------------------------------------------------------------------ */

  async listDocuments(
    query: ListDocumentsQuery,
    actor: AuthenticatedUser,
  ): Promise<{ items: WorkspaceDocumentSummary[]; meta: PaginationMeta }> {
    const grants = await this.access.listAccessibleNodes(actor.id, actor.role as Role);
    const readable = grants
      .filter((grant) => grant.capabilities.viewDocument)
      .map((grant) => grant.nodeId);

    if (readable.length === 0) {
      return { items: [], meta: emptyMeta(query) };
    }

    // The node filter is intersected with what the caller may read, never
    // substituted for it: passing `?nodeId=` for a node you have no grant on
    // must narrow the result to nothing, not widen it.
    const nodeIds = query.nodeId ? readable.filter((nodeId) => nodeId === query.nodeId) : readable;

    const restricted = await this.team.restrictedDocumentIds(actor.id);

    const where: Prisma.DocumentWhereInput = {
      deletedAt: null,
      project: { nodeId: { in: nodeIds }, deletedAt: null },
      // The same exclusion the tree applies, so a restricted document cannot
      // reappear through a search, a filter, or the recent list.
      ...(restricted.length > 0 ? { id: { notIn: restricted } } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.stage ? { stage: query.stage as ProjectStage } : {}),
      ...(query.status ? { status: query.status as DocumentStatus } : {}),
      ...(query.favorite ? { favorites: { some: { userId: actor.id } } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { project: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const result = await paginate<DocumentRow, Prisma.DocumentWhereInput, never>(
      this.prisma.document,
      query,
      {
        where,
        select: DOCUMENT_SELECT,
        allowedSortFields: SORTABLE_FIELDS,
        defaultSortField: 'updatedAt',
      },
    );

    const [favouriteIds, ancestry] = await Promise.all([
      this.favouriteIds(actor.id),
      this.ancestorNames(),
    ]);

    return {
      items: result.items.map((row) => toDocumentSummary(row, favouriteIds, ancestry)),
      meta: result.meta,
    };
  }

  async createDocument(
    input: CreateDocumentInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<WorkspaceDocumentSummary> {
    const nodeId = await this.access.nodeIdOfProject(input.projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'createDocument');

    if (input.templateId) {
      const template = await this.prisma.documentTemplate.findUnique({
        where: { id: input.templateId },
        select: { id: true, isActive: true },
      });
      if (!template) throw AppException.notFound('Document template');
      if (!template.isActive) {
        throw AppException.conflict('Template tersebut sudah tidak aktif');
      }
    }

    // A new document goes to the end of the list and stays there: the order is
    // fixed at creation, so saving never moves a row. Deleted rows are counted
    // too, which only leaves a gap — gaps are harmless, reuse is not.
    const last = await this.prisma.document.aggregate({
      where: { projectId: input.projectId },
      _max: { position: true },
    });

    const row = await this.prisma.document.create({
      data: {
        title: input.title,
        projectId: input.projectId,
        position: (last._max.position ?? -1) + 1,
        templateId: input.templateId,
        stage: input.stage as ProjectStage,
        ownerId: actor.id,
        // Denormalised so the list still names an owner after the account goes.
        ownerName: actor.email,
        createdById: actor.id,
      },
      select: DOCUMENT_SELECT,
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.DOCUMENT_CREATED,
      entity: 'Document',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: { projectId: input.projectId, templateId: input.templateId },
    });

    const [favouriteIds, ancestry] = await Promise.all([
      this.favouriteIds(actor.id),
      this.ancestorNames(),
    ]);
    return toDocumentSummary(row, favouriteIds, ancestry);
  }

  /**
   * Withdraws a document.
   *
   * A soft delete, like everything else an auditor may need: the row keeps its
   * versions and its files and simply leaves every list. Guarded by the same
   * capability as editing one — someone who may rename a checklist entry may
   * also decide it does not apply to this project.
   */
  async removeDocument(id: string, actor: AuthenticatedUser, client: ClientInfo): Promise<void> {
    const nodeId = await this.access.nodeIdOfDocument(id);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'createDocument');

    const before = await this.prisma.document.findUnique({
      where: { id },
      select: DOCUMENT_SELECT,
    });
    if (!before || before.deletedAt) throw AppException.notFound('Dokumen');

    const after = await this.prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: DOCUMENT_SELECT,
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.DOCUMENT_DELETED,
      entity: 'Document',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before,
      after,
    });

    await this.projectStage.sync(before.projectId);
  }

  async updateDocument(
    id: string,
    input: UpdateDocumentInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<WorkspaceDocumentSummary> {
    const nodeId = await this.access.nodeIdOfDocument(id);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'createDocument');

    const row = await this.prisma.document.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.stage !== undefined ? { stage: input.stage as ProjectStage } : {}),
        ...(input.status !== undefined ? { status: input.status as DocumentStatus } : {}),
        ...(input.content !== undefined ? { content: input.content as Prisma.InputJsonValue } : {}),
      },
      select: DOCUMENT_SELECT,
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.DOCUMENT_UPDATED,
      entity: 'Document',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: { changes: Object.keys(input) },
    });

    await this.projectStage.sync(row.projectId);

    const [favouriteIds, ancestry] = await Promise.all([
      this.favouriteIds(actor.id),
      this.ancestorNames(),
    ]);
    return toDocumentSummary(row, favouriteIds, ancestry);
  }

  /** Starring is personal, so it needs read access and nothing more. */
  async setFavorite(id: string, favorite: boolean, actor: AuthenticatedUser): Promise<void> {
    const nodeId = await this.access.nodeIdOfDocument(id);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'viewDocument');

    if (favorite) {
      await this.prisma.documentFavorite.upsert({
        where: { userId_documentId: { userId: actor.id, documentId: id } },
        create: { userId: actor.id, documentId: id },
        update: {},
      });
      return;
    }

    await this.prisma.documentFavorite.deleteMany({
      where: { userId: actor.id, documentId: id },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Projects                                                             */
  /* ------------------------------------------------------------------ */

  async createProject(
    input: CreateProjectInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<ProjectView> {
    await this.access.requireCapability(
      actor.id,
      actor.role as Role,
      input.nodeId,
      'createProject',
    );

    const clash = await this.prisma.project.findUnique({
      where: { nodeId_code: { nodeId: input.nodeId, code: input.code } },
      select: { id: true },
    });
    if (clash)
      throw AppException.conflict(`Kode project "${input.code}" sudah dipakai di node ini`);

    const project = await this.prisma.project.create({
      data: {
        nodeId: input.nodeId,
        name: input.name,
        code: input.code,
        description: input.description,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        goLiveAt: input.goLiveAt ? new Date(input.goLiveAt) : null,
        createdById: actor.id,
      },
      select: { id: true },
    });

    await this.seedDefaultDocuments(project.id, actor);

    await this.auditService.record({
      action: AUDIT_ACTIONS.PROJECT_CREATED,
      entity: 'Project',
      entityId: project.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: {
        nodeId: input.nodeId,
        code: input.code,
        seededDocuments: DEFAULT_PROJECT_DOCUMENTS.length,
      },
    });

    return this.findProject(project.id, actor);
  }

  /**
   * Creates the standard document checklist for a brand-new project.
   *
   * The template lookup is one query for every code the checklist names, not
   * one per document, and a code with no template is simply left unlinked —
   * a project must not fail to be created because a template has not been
   * seeded yet.
   */
  private async seedDefaultDocuments(
    projectId: string,
    actor: Pick<AuthenticatedUser, 'id' | 'email'>,
  ): Promise<void> {
    const codes = [
      ...new Set(
        DEFAULT_PROJECT_DOCUMENTS.map((entry) => entry.templateCode).filter(
          (code): code is string => Boolean(code),
        ),
      ),
    ];

    const templates =
      codes.length === 0
        ? []
        : await this.prisma.documentTemplate.findMany({
            where: { code: { in: codes }, isActive: true },
            select: { id: true, code: true },
          });

    const templateIdByCode = new Map(templates.map((row) => [row.code, row.id]));

    await this.prisma.document.createMany({
      data: DEFAULT_PROJECT_DOCUMENTS.map((entry, position) => ({
        projectId,
        position,
        title: entry.title,
        screen: entry.screen ?? null,
        templateId: entry.templateCode ? (templateIdByCode.get(entry.templateCode) ?? null) : null,
        // Owned by whoever created the project, exactly as a hand-made document
        // is owned by whoever created it. A seeded row with no owner reads as a
        // row nobody is responsible for, which is not what it means.
        ownerId: actor.id,
        ownerName: actor.email,
        createdById: actor.id,
      })),
    });
  }

  async updateProject(
    id: string,
    input: UpdateProjectInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<ProjectView> {
    const nodeId = await this.access.nodeIdOfProject(id);
    // Moving a stage and renaming a project are both "running the project", so
    // they sit behind the same capability rather than inventing a second one.
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'manageProject');

    if (input.code !== undefined) {
      // `(nodeId, code)` is unique. Checked here so a clash answers with the
      // code that is taken, rather than letting the constraint surface as an
      // opaque 500 from Prisma.
      const clash = await this.prisma.project.findUnique({
        where: { nodeId_code: { nodeId, code: input.code } },
        select: { id: true },
      });
      if (clash && clash.id !== id) {
        throw AppException.conflict(`Kode project "${input.code}" sudah dipakai di node ini`);
      }
    }

    await this.prisma.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status as ProjectStatus } : {}),
        ...(input.startsAt !== undefined
          ? { startsAt: input.startsAt ? new Date(input.startsAt) : null }
          : {}),
        ...(input.goLiveAt !== undefined
          ? { goLiveAt: input.goLiveAt ? new Date(input.goLiveAt) : null }
          : {}),
      },
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.PROJECT_UPDATED,
      entity: 'Project',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: { changes: Object.keys(input) },
    });

    return this.findProject(id, actor);
  }

  /**
   * Deletes a project — and only its creator may.
   *
   * Not a matrix capability: a Manager runs projects other people started, and
   * throwing away someone else's work is not "running" it. SUPER_ADMIN gets no
   * exemption either, which is what the rule asks for. A project created before
   * `createdById` was recorded has no creator and so cannot be deleted here.
   *
   * A soft delete, for the same reason a document's is: the documents and their
   * versions are what an auditor asks about later. The code is released so the
   * node can reuse it — the unique `(nodeId, code)` pair would otherwise hold it
   * forever — and the original stays in the audit record's `before`.
   */
  async removeProject(id: string, actor: AuthenticatedUser, client: ClientInfo): Promise<void> {
    // Also answers 404 for a project already deleted.
    const nodeId = await this.access.nodeIdOfProject(id);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'viewProject');

    const before = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      select: PROJECT_DELETE_SELECT,
    });
    if (before.createdById !== actor.id) {
      throw AppException.forbidden('Hanya pembuat project yang boleh menghapusnya');
    }

    const after = await this.prisma.project.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        code: `${before.code}~deleted-${Date.now().toString(36)}`,
      },
      select: PROJECT_DELETE_SELECT,
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.PROJECT_DELETED,
      entity: 'Project',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before,
      after,
    });
  }

  async findProject(id: string, actor: AuthenticatedUser): Promise<ProjectView> {
    const project = await this.prisma.project.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        stage: true,
        status: true,
        startsAt: true,
        goLiveAt: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        node: { select: { id: true, name: true, code: true } },
        documents: {
          where: { deletedAt: null },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: DOCUMENT_SELECT,
        },
      },
    });
    if (!project) throw AppException.notFound('Project');

    const access = await this.access.requireCapability(
      actor.id,
      actor.role as Role,
      project.node.id,
      'viewProject',
    );

    const [favouriteIds, ancestry] = await Promise.all([
      this.favouriteIds(actor.id),
      this.ancestorNames(),
    ]);

    const restricted = new Set(await this.team.restrictedDocumentIds(actor.id));
    const documents = project.documents
      .filter((document) => !restricted.has(document.id))
      .map((document) => toDocumentSummary(document, favouriteIds, ancestry));

    return {
      id: project.id,
      name: project.name,
      code: project.code,
      description: project.description,
      stage: project.stage as ProjectStage,
      status: project.status as ProjectStatus,
      startsAt: project.startsAt?.toISOString() ?? null,
      goLiveAt: project.goLiveAt?.toISOString() ?? null,
      node: {
        id: project.node.id,
        name: project.node.name,
        code: project.node.code,
        path: ancestry.get(project.node.id) ?? [],
      },
      capabilities: access.capabilities,
      canDelete: project.createdById !== null && project.createdById === actor.id,
      documents,
      members: await this.team.listMembers(project.id, actor),
      progress: computeProgress(documents),
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Shared lookups                                                       */
  /* ------------------------------------------------------------------ */

  private async favouriteIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.documentFavorite.findMany({
      where: { userId },
      select: { documentId: true },
    });
    return new Set(rows.map((row) => row.documentId));
  }

  /**
   * Ancestor names for every node, so a breadcrumb costs no extra query per
   * row. The hierarchy is small enough to hold whole — it is an org chart, not
   * a data set — and walking it per document would be a query per line of the
   * recent list.
   */
  private async ancestorNames(): Promise<Map<string, string[]>> {
    const nodes = await this.prisma.node.findMany({
      select: { id: true, name: true, parentId: true },
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const cache = new Map<string, string[]>();

    const pathOf = (nodeId: string, seen = new Set<string>()): string[] => {
      const cached = cache.get(nodeId);
      if (cached) return cached;

      const node = byId.get(nodeId);
      if (!node || seen.has(nodeId)) return [];
      seen.add(nodeId);

      const path = node.parentId ? [...pathOf(node.parentId, seen), node.name] : [node.name];
      cache.set(nodeId, path);
      return path;
    };

    for (const node of nodes) pathOf(node.id);
    return cache;
  }
}

function toDocumentSummary(
  row: DocumentRow,
  favouriteIds: Set<string>,
  ancestry: Map<string, string[]>,
): WorkspaceDocumentSummary {
  const nodePath = ancestry.get(row.project.node.id) ?? [row.project.node.name];
  // `IAMI / ESS-IT / Uji Katalog Dokumen` — the last two levels of the node
  // path plus the project, which is what identifies a document at a glance
  // without spelling out the whole org chart on every line.
  const breadcrumb = [...nodePath.slice(-2), row.project.name].join(' / ');

  return {
    id: row.id,
    title: row.title,
    screen: row.screen as DocumentScreen | null,
    templateCode: row.template?.code ?? null,
    stage: row.stage as ProjectStage,
    status: row.status as DocumentStatus,
    ownerName: row.ownerName,
    isFavorite: favouriteIds.has(row.id),
    updatedAt: row.updatedAt.toISOString(),
    projectId: row.project.id,
    projectName: row.project.name,
    nodeId: row.project.node.id,
    nodeName: row.project.node.name,
    breadcrumb,
  };
}

function emptyMeta(query: ListDocumentsQuery): PaginationMeta {
  return {
    page: query.page,
    limit: query.limit,
    total: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  };
}
