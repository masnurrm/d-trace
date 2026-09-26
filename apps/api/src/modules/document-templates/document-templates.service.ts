import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  type CreateDocumentTemplateInput,
  type DocumentTemplateSummary,
  type DocumentTemplateView,
  type ListDocumentTemplatesQuery,
  type PaginationMeta,
  type TemplateSectionInput,
  type TemplateSectionView,
  type UpdateDocumentTemplateInput,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { paginate } from '../../common/utils/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TemplateAssetService } from './template-asset.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** Sortable columns are an allow-list; user input never reaches `orderBy`. */
const SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'name', 'code', 'version'] as const;

const SUMMARY_SELECT = {
  id: true,
  name: true,
  code: true,
  version: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { sections: true } },
} satisfies Prisma.DocumentTemplateSelect;

type SummaryRow = Prisma.DocumentTemplateGetPayload<{ select: typeof SUMMARY_SELECT }>;

const DETAIL_INCLUDE = {
  sections: { orderBy: { position: 'asc' } },
} satisfies Prisma.DocumentTemplateInclude;

type DetailRow = Prisma.DocumentTemplateGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/**
 * Master document templates.
 *
 * A template is saved as a whole: the builder sends the complete section list
 * and it is replaced inside one transaction. Saving section by section would
 * leave the document half-reordered whenever one call failed, and an ordering
 * that is only half applied is worse than one that was never touched.
 */
@Injectable()
export class DocumentTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly assets: TemplateAssetService,
  ) {}

  async list(
    query: ListDocumentTemplatesQuery,
  ): Promise<{ items: DocumentTemplateSummary[]; meta: PaginationMeta }> {
    const where: Prisma.DocumentTemplateWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const result = await paginate<SummaryRow, Prisma.DocumentTemplateWhereInput, never>(
      this.prisma.documentTemplate,
      query,
      {
        where,
        select: SUMMARY_SELECT,
        allowedSortFields: SORTABLE_FIELDS,
        defaultSortField: 'updatedAt',
      },
    );

    return { items: result.items.map(toSummary), meta: result.meta };
  }

  async findById(id: string): Promise<DocumentTemplateView> {
    const row = await this.prisma.documentTemplate.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!row) throw AppException.notFound('Document template');

    return toView(row);
  }

  async create(
    input: CreateDocumentTemplateInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<DocumentTemplateView> {
    await this.assertCodeIsFree(input.code, null);

    const row = await this.prisma.documentTemplate.create({
      data: {
        name: input.name,
        code: input.code,
        version: input.version,
        description: input.description,
        isActive: input.isActive,
        updatedById: actor.id,
      },
      include: DETAIL_INCLUDE,
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.DOCUMENT_TEMPLATE_CREATED,
      entity: 'DocumentTemplate',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      after: row,
    });

    return toView(row);
  }

  /**
   * Replaces the template and its whole section list.
   *
   * Sections the payload still carries an id for are updated in place, so a
   * document already bound to one keeps pointing at the same row; everything
   * else is created, and anything the payload dropped is deleted.
   */
  async update(
    id: string,
    input: UpdateDocumentTemplateInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<DocumentTemplateView> {
    const current = await this.prisma.documentTemplate.findUnique({
      where: { id },
      select: { id: true, code: true, updatedAt: true },
    });
    if (!current) throw AppException.notFound('Document template');

    // Optimistic concurrency, the same guard `PUT /settings` uses: two editors
    // with the builder open would otherwise both save, and the second would
    // silently erase the first one's sections.
    if (input.expectedUpdatedAt && current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw AppException.conflict(
        'Template sudah diubah di tempat lain. Muat ulang halaman lalu ulangi perubahan Anda.',
      );
    }

    if (input.code !== current.code) await this.assertCodeIsFree(input.code, id);

    // An id is only a claim until checked: a section pointing at an image that
    // does not exist would save fine and print a broken picture in every
    // document built from it.
    const missing = await this.assets.missing(
      input.sections.flatMap((section) => [
        ...section.attachments.map((item) => item.assetId),
        ...(section.type === 'HEADER' && section.config.logoAssetId
          ? [section.config.logoAssetId]
          : []),
      ]),
    );
    if (missing.length > 0) {
      throw AppException.validation([
        { field: 'sections', message: 'Ada gambar lampiran yang tidak ditemukan. Unggah ulang.' },
      ]);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const keptIds = input.sections
        .map((section) => section.id)
        .filter((sectionId): sectionId is string => Boolean(sectionId));

      // With nothing kept the clause is dropped entirely: `notIn` against a
      // placeholder would make Postgres cast a non-UUID and fail the request.
      await tx.documentTemplateSection.deleteMany({
        where: {
          templateId: id,
          ...(keptIds.length > 0 ? { id: { notIn: keptIds } } : {}),
        },
      });

      // Sequential on purpose: the `(templateId, key)` unique index means two
      // concurrent writes swapping two keys would deadlock against each other.
      for (const [index, section] of input.sections.entries()) {
        const data = toSectionData(section, index);
        if (section.id) {
          // `updateMany` scoped by templateId: an id from another template must
          // not become an editing primitive for a template this request names.
          const touched = await tx.documentTemplateSection.updateMany({
            where: { id: section.id, templateId: id },
            data,
          });
          if (touched.count > 0) continue;
        }
        await tx.documentTemplateSection.create({ data: { ...data, templateId: id } });
      }

      return tx.documentTemplate.update({
        where: { id },
        data: {
          name: input.name,
          code: input.code,
          version: input.version,
          description: input.description,
          isActive: input.isActive,
          updatedById: actor.id,
        },
        include: DETAIL_INCLUDE,
      });
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.DOCUMENT_TEMPLATE_UPDATED,
      entity: 'DocumentTemplate',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: current,
      after: row,
    });

    return toView(row);
  }

  /** Copies a template under a new code, sections and all. */
  async duplicate(
    id: string,
    code: string,
    name: string,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<DocumentTemplateView> {
    const source = await this.prisma.documentTemplate.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!source) throw AppException.notFound('Document template');

    await this.assertCodeIsFree(code, null);

    const row = await this.prisma.documentTemplate.create({
      data: {
        name,
        code,
        version: source.version,
        description: source.description,
        isActive: source.isActive,
        updatedById: actor.id,
        sections: {
          create: source.sections.map((section) => ({
            title: section.title,
            key: section.key,
            type: section.type,
            source: section.source,
            binding: section.binding,
            content: section.content,
            config: section.config as Prisma.InputJsonValue,
            attachments: section.attachments as Prisma.InputJsonValue,
            editable: section.editable,
            required: section.required,
            visible: section.visible,
            position: section.position,
          })),
        },
      },
      include: DETAIL_INCLUDE,
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.DOCUMENT_TEMPLATE_DUPLICATED,
      entity: 'DocumentTemplate',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      // The source is not part of the new row, so it stays in metadata.
      metadata: { sourceId: source.id, sourceCode: source.code },
      after: row,
    });

    return toView(row);
  }

  async remove(id: string, actor: AuthenticatedUser, client: ClientInfo): Promise<void> {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id },
      select: { id: true, code: true, name: true },
    });
    if (!template) throw AppException.notFound('Document template');

    // Sections cascade; the template itself is the only row deleted here.
    await this.prisma.documentTemplate.delete({ where: { id } });

    await this.auditService.record({
      action: AUDIT_ACTIONS.DOCUMENT_TEMPLATE_DELETED,
      entity: 'DocumentTemplate',
      entityId: template.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: template,
    });
  }

  private async assertCodeIsFree(code: string, exceptId: string | null): Promise<void> {
    const existing = await this.prisma.documentTemplate.findUnique({
      where: { code },
      select: { id: true },
    });
    if (existing && existing.id !== exceptId) {
      throw AppException.conflict(`Kode template "${code}" sudah dipakai`);
    }
  }
}

function toSectionData(
  section: TemplateSectionInput,
  position: number,
): Omit<Prisma.DocumentTemplateSectionUncheckedCreateInput, 'templateId'> {
  return {
    title: section.title,
    key: section.key,
    type: section.type,
    source: section.source,
    binding: section.binding,
    content: section.content,
    config: section.config as Prisma.InputJsonValue,
    attachments: section.attachments as Prisma.InputJsonValue,
    editable: section.editable,
    required: section.required,
    visible: section.visible,
    position,
  };
}

function toSummary(row: SummaryRow): DocumentTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    version: row.version,
    description: row.description,
    isActive: row.isActive,
    sectionCount: row._count.sections,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toView(row: DetailRow): DocumentTemplateView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    version: row.version,
    description: row.description,
    isActive: row.isActive,
    sectionCount: row.sections.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sections: row.sections.map(
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
          // The union is discriminated by `type`, which Prisma types as the
          // enum rather than a literal; the config was validated against that
          // same type on the way in, so the pairing is sound by construction.
        }) as TemplateSectionView,
    ),
  };
}
