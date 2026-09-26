import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  changedSectionKeys,
  emptyContentFor,
  parseDocumentContent,
  type DataContent,
  type DocumentContent,
  type DocumentDetail,
  type DocumentStatus,
  type DocumentVersionDetail,
  type DocumentVersionSummary,
  type ProjectStage,
  type RestoreDocumentVersionInput,
  type Role,
  type SaveDocumentContentInput,
  type ProjectDataSet,
  type TemplateSectionView,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ProjectDataService } from './project-data.service.js';
import { ProjectTeamService } from './project-team.service.js';
import { sanitizeDocumentContent } from './rich-text.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

const DETAIL_SELECT = {
  id: true,
  title: true,
  screen: true,
  stage: true,
  status: true,
  ownerName: true,
  content: true,
  updatedAt: true,
  project: {
    select: { id: true, name: true, nodeId: true, node: { select: { id: true, name: true } } },
  },
  template: {
    select: {
      id: true,
      name: true,
      code: true,
      version: true,
      sections: { orderBy: { position: 'asc' } },
    },
  },
} satisfies Prisma.DocumentSelect;

type DetailRow = Prisma.DocumentGetPayload<{ select: typeof DETAIL_SELECT }>;

/**
 * Filling a document in, and everything that was ever written in it.
 *
 * The template owns the shape, this owns the answers, and `DocumentVersion`
 * owns the record of how those answers got there. Each save appends a version;
 * nothing rewrites one. That is what makes "what did this say when it was
 * approved?" a question with an answer rather than a hope.
 */
@Injectable()
export class DocumentContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly team: ProjectTeamService,
    private readonly auditService: AuditService,
    private readonly projectData: ProjectDataService,
  ) {}

  async findById(id: string, actor: AuthenticatedUser): Promise<DocumentDetail> {
    const row = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      select: DETAIL_SELECT,
    });
    if (!row) throw AppException.notFound('Document');

    const access = await this.access.requireCapability(
      actor.id,
      actor.role as Role,
      row.project.nodeId,
      'viewDocument',
    );

    // A restriction has to reach the editor as well as the lists, and it reads
    // as absence rather than refusal — the same answer every list already gives.
    if (await this.team.isRestricted(actor.id, id)) throw AppException.notFound('Document');

    const sections = toSections(row);
    const { content } = parseDocumentContent(sections, row.content);

    const latest = await this.prisma.documentVersion.findFirst({
      where: { documentId: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const override = await this.prisma.documentPermission.findUnique({
      where: { documentId_userId: { documentId: id, userId: actor.id } },
      select: { canEdit: true },
    });

    // Only a document with a DATA section needs the datasets; the context is
    // cheap and every template may bind to it.
    const [context, projectData] = await Promise.all([
      this.projectData.context(row.project.id),
      sections.some((section) => section.type === 'DATA')
        ? this.projectData.datasets(row.project.id)
        : Promise.resolve({} as ProjectDataSet),
    ]);

    return {
      context,
      projectData,
      id: row.id,
      title: row.title,
      stage: row.stage as ProjectStage,
      status: row.status as DocumentStatus,
      ownerName: row.ownerName,
      projectId: row.project.id,
      screen: row.screen,
      projectName: row.project.name,
      nodeName: row.project.node.name,
      breadcrumb: `${row.project.node.name} / ${row.project.name}`,
      template: row.template
        ? {
            id: row.template.id,
            name: row.template.name,
            code: row.template.code,
            version: row.template.version,
            sections,
          }
        : null,
      content,
      currentVersion: latest?.version ?? 0,
      capabilities: {
        view: true,
        // An override decides for this document; otherwise the node grant does.
        edit: override ? override.canEdit : access.capabilities.createDocument,
      },
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Saves the answers as a new version.
   *
   * The document's own `content` is updated to match, so the common read needs
   * no join, and the version row is what makes the change recoverable.
   */
  async save(
    id: string,
    input: SaveDocumentContentInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<DocumentDetail> {
    const current = await this.requireEditable(id, actor);

    if (input.expectedUpdatedAt && current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw AppException.conflict(
        'Dokumen sudah diubah di tempat lain. Muat ulang halaman lalu ulangi perubahan Anda.',
      );
    }

    const sections = toSections(current);
    const { content: parsed, issues } = parseDocumentContent(sections, input.content);
    // Sanitised here, not in `parseDocumentContent`: that lives in the contract
    // package, which carries no runtime dependencies by design.
    const content = sanitizeDocumentContent(sections, parsed);
    if (issues.length > 0) {
      throw AppException.validation(
        issues.map((message) => ({ field: 'content', message })),
      );
    }

    const previous = (current.content ?? {}) as DocumentContent;
    await this.captureData(current.project.id, sections, previous, content);

    const status = (input.status ?? current.status) as DocumentStatus;
    const changed = changedSectionKeys(previous, content);

    // Nothing changed and nothing was said about it: writing a version here
    // would fill the history with entries that record no decision.
    if (
      changed.length === 0 &&
      !input.note &&
      status === current.status &&
      (input.stage ?? current.stage) === current.stage
    ) {
      return this.findById(id, actor);
    }

    await this.prisma.$transaction(async (tx) => {
      const latest = await tx.documentVersion.findFirst({
        where: { documentId: id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });

      await tx.documentVersion.create({
        data: {
          documentId: id,
          version: (latest?.version ?? 0) + 1,
          content: content as Prisma.InputJsonValue,
          note: input.note,
          status,
          createdById: actor.id,
          createdByName: actor.email,
        },
      });

      await tx.document.update({
        where: { id },
        data: {
          content: content as Prisma.InputJsonValue,
          status,
          ...(input.stage !== undefined ? { stage: input.stage as ProjectStage } : {}),
        },
      });
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.DOCUMENT_VERSION_SAVED,
      entity: 'Document',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: { changedSections: changed, status },
    });

    return this.findById(id, actor);
  }

  async listVersions(id: string, actor: AuthenticatedUser): Promise<DocumentVersionSummary[]> {
    await this.requireReadable(id, actor);

    const rows = await this.prisma.documentVersion.findMany({
      where: { documentId: id },
      orderBy: { version: 'asc' },
    });

    // Each entry names what it changed relative to the one before it, so the
    // list reads as a story rather than as a column of timestamps.
    const summaries: DocumentVersionSummary[] = rows.map((row, index) => ({
      id: row.id,
      version: row.version,
      note: row.note,
      status: row.status as DocumentStatus,
      restoredFrom: row.restoredFrom,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
      changedSections: changedSectionKeys(
        index === 0 ? null : ((rows[index - 1]!.content ?? {}) as DocumentContent),
        (row.content ?? {}) as DocumentContent,
      ),
    }));

    // Newest first for reading; the diffs above needed oldest first.
    return summaries.reverse();
  }

  async findVersion(
    id: string,
    version: number,
    actor: AuthenticatedUser,
  ): Promise<DocumentVersionDetail> {
    await this.requireReadable(id, actor);

    const row = await this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId: id, version } },
    });
    if (!row) throw AppException.notFound('Document version');

    const previous = await this.prisma.documentVersion.findFirst({
      where: { documentId: id, version: { lt: version } },
      orderBy: { version: 'desc' },
      select: { content: true },
    });

    return {
      id: row.id,
      version: row.version,
      note: row.note,
      status: row.status as DocumentStatus,
      restoredFrom: row.restoredFrom,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
      changedSections: changedSectionKeys(
        previous ? ((previous.content ?? {}) as DocumentContent) : null,
        (row.content ?? {}) as DocumentContent,
      ),
      content: (row.content ?? {}) as DocumentContent,
    };
  }

  /**
   * Restores an earlier version by writing its content as a *new* one.
   *
   * The history is never rewound: the restore itself is an event worth
   * recording, and a version that vanished because someone went back would
   * take the reason for going back with it.
   */
  async restore(
    id: string,
    input: RestoreDocumentVersionInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<DocumentDetail> {
    await this.requireEditable(id, actor);

    const source = await this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId: id, version: input.version } },
    });
    if (!source) throw AppException.notFound('Document version');

    await this.prisma.$transaction(async (tx) => {
      const latest = await tx.documentVersion.findFirst({
        where: { documentId: id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });

      await tx.documentVersion.create({
        data: {
          documentId: id,
          version: (latest?.version ?? 0) + 1,
          content: source.content as Prisma.InputJsonValue,
          note: input.note ?? `Dikembalikan ke versi ${source.version}`,
          status: source.status,
          restoredFrom: source.version,
          createdById: actor.id,
          createdByName: actor.email,
        },
      });

      await tx.document.update({
        where: { id },
        data: { content: source.content as Prisma.InputJsonValue, status: source.status },
      });
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.DOCUMENT_VERSION_RESTORED,
      entity: 'Document',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: { restoredFrom: source.version },
    });

    return this.findById(id, actor);
  }

  /** For the image upload, which writes into a document as surely as a save does. */
  async assertEditable(id: string, actor: AuthenticatedUser): Promise<void> {
    await this.requireEditable(id, actor);
  }

  /* ------------------------------------------------------------------ */

  /**
   * Decides, server-side, what every DATA section stores.
   *
   * The numbers are never the browser's: a section keeps its previous snapshot
   * unless it has none yet or the author asked for a refresh, and in both of
   * those cases the snapshot is taken here, from the database, now. A forged
   * "Effort" table in a request body therefore changes nothing.
   */
  private async captureData(
    projectId: string,
    sections: TemplateSectionView[],
    previous: DocumentContent,
    content: DocumentContent,
  ): Promise<void> {
    const dataSections = sections.filter((section) => section.type === 'DATA');
    if (dataSections.length === 0) return;

    let fresh: ProjectDataSet | null = null;
    const now = new Date().toISOString();

    for (const section of dataSections) {
      if (section.type !== 'DATA') continue;
      const incoming = content[section.key] as DataContent;
      const before = previous[section.key] as Partial<DataContent> | undefined;

      if (before?.data && before.capturedAt && !incoming.refresh) {
        content[section.key] = {
          capturedAt: before.capturedAt,
          refresh: false,
          data: before.data,
          ...(incoming.effortTable ? { effortTable: incoming.effortTable } : {}),
        };
        continue;
      }

      fresh ??= await this.projectData.datasets(projectId);
      content[section.key] = {
        capturedAt: now,
        refresh: false,
        data: fresh[section.config.dataset] ?? null,
        ...(incoming.effortTable ? { effortTable: incoming.effortTable } : {}),
      };
    }
  }

  private async requireReadable(id: string, actor: AuthenticatedUser): Promise<void> {
    const nodeId = await this.access.nodeIdOfDocument(id);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'viewDocument');
    if (await this.team.isRestricted(actor.id, id)) throw AppException.notFound('Document');
  }

  private async requireEditable(id: string, actor: AuthenticatedUser): Promise<DetailRow> {
    const row = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      select: DETAIL_SELECT,
    });
    if (!row) throw AppException.notFound('Document');

    const access = await this.access.requireCapability(
      actor.id,
      actor.role as Role,
      row.project.nodeId,
      'viewDocument',
    );

    const override = await this.prisma.documentPermission.findUnique({
      where: { documentId_userId: { documentId: id, userId: actor.id } },
      select: { canView: true, canEdit: true },
    });

    if (override && !override.canView) throw AppException.notFound('Document');

    const mayEdit = override ? override.canEdit : access.capabilities.createDocument;
    if (!mayEdit) {
      throw AppException.forbidden('Anda tidak punya izin mengubah dokumen ini');
    }

    return row;
  }
}

/**
 * The template's sections, typed as the contract describes them.
 *
 * Prisma types `type` as the enum and `config` as `JsonValue`; the pairing was
 * validated by the discriminated union when the template was saved, so it is
 * sound by construction here.
 */
function toSections(row: DetailRow): TemplateSectionView[] {
  if (!row.template) return [];

  return row.template.sections.map(
    (section) =>
      ({
        id: section.id,
        title: section.title,
        key: section.key,
        type: section.type,
        source: section.source,
        binding: section.binding,
        content: section.content,
        config: section.config,
        attachments: section.attachments,
        editable: section.editable,
        required: section.required,
        visible: section.visible,
        position: section.position,
      }) as TemplateSectionView,
  );
}

/** Exported for the editor's benefit: a blank answer for a new section. */
export { emptyContentFor };
