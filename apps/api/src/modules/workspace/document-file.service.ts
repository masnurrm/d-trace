import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUDIT_ACTIONS, type Role } from '@dtrace/shared';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import type { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/exceptions/app.exception.js';
import { RASTER_EXTENSIONS, assertRasterImage } from '../../common/utils/raster-image.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectTeamService } from './project-team.service.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

/**
 * Formats people actually exchange for these documents. An allow-list rather
 * than a deny-list: a new office format is a deliberate addition, whereas a
 * deny-list is a list of the attacks somebody already thought of.
 */
const ALLOWED_MIME_TYPES = new Map<string, string>([
  ['application/pdf', '.pdf'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.ms-powerpoint', '.ppt'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['application/zip', '.zip'],
]);

export interface UploadedFile {
  originalName: string;
  mimeType: string;
  bytes: Buffer;
}

export interface StoredFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: string;
}

/**
 * Files attached to documents.
 *
 * Bytes go to disk under `UPLOAD_DIR`; the database keeps the metadata. The
 * name on disk is generated here and never derived from what was uploaded — an
 * uploaded filename is attacker-controlled, and letting it reach a path is how
 * `../../.env` ends up being written to.
 */
@Injectable()
export class DocumentFileService {
  private readonly logger = new Logger(DocumentFileService.name);
  private readonly uploadDir: string;
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly team: ProjectTeamService,
    private readonly auditService: AuditService,
    config: ConfigService<AppConfig, true>,
  ) {
    const upload = config.get('upload', { infer: true });
    // Resolved once, so every path built below is compared against an absolute
    // base rather than against whatever the working directory happens to be.
    this.uploadDir = resolve(upload.dir);
    this.maxBytes = upload.maxBytes;
  }

  /** Rejects anything the document store will not accept, before it is written. */
  assertAcceptable(file: UploadedFile): void {
    if (file.bytes.length === 0) {
      throw AppException.validation([{ field: 'file', message: 'Berkas kosong' }]);
    }

    if (file.bytes.length > this.maxBytes) {
      throw new AppException(
        'PAYLOAD_TOO_LARGE',
        `Berkas melebihi batas ${Math.round(this.maxBytes / 1024 / 1024)} MB`,
        413,
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimeType)) {
      throw AppException.validation([
        { field: 'file', message: `Jenis berkas "${file.mimeType}" tidak didukung` },
      ]);
    }
  }

  async attach(
    documentId: string,
    file: UploadedFile,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<StoredFile> {
    const nodeId = await this.access.nodeIdOfDocument(documentId);
    const access = await this.access.requireCapability(
      actor.id,
      actor.role as Role,
      nodeId,
      'viewDocument',
    );
    const override = await this.prisma.documentPermission.findUnique({
      where: { documentId_userId: { documentId, userId: actor.id } },
      select: { canView: true, canEdit: true },
    });
    if (override && !override.canView) throw AppException.notFound('Document');
    if (!(override ? override.canEdit : access.capabilities.createDocument)) {
      throw AppException.forbidden('Anda tidak punya izin mengubah dokumen ini');
    }

    this.assertAcceptable(file);

    // The extension comes from the allow-listed type, not from the name, so a
    // `report.pdf.exe` lands on disk as a `.pdf` and nothing else.
    const extension = ALLOWED_MIME_TYPES.get(file.mimeType) ?? extname(file.originalName);
    const storageKey = `${randomUUID()}${extension}`;

    await mkdir(this.uploadDir, { recursive: true });
    await writeFile(join(this.uploadDir, storageKey), file.bytes);

    try {
      const row = await this.prisma.documentFile.create({
        data: {
          documentId,
          fileName: safeDisplayName(file.originalName),
          mimeType: file.mimeType,
          sizeBytes: file.bytes.length,
          storageKey,
          uploadedById: actor.id,
          uploadedByName: actor.email,
        },
      });

      await this.auditService.record({
        action: AUDIT_ACTIONS.DOCUMENT_FILE_UPLOADED,
        entity: 'Document',
        entityId: documentId,
        actorId: actor.id,
        actorEmail: actor.email,
        ip: client.ip,
        userAgent: client.userAgent,
        metadata: { fileName: row.fileName, sizeBytes: row.sizeBytes, mimeType: row.mimeType },
      });

      return toStored(row);
    } catch (error) {
      // The row is the record of truth. A file on disk with nothing pointing at
      // it is litter nobody will ever find, so it goes with the failed write.
      await unlink(join(this.uploadDir, storageKey)).catch(() => undefined);
      throw error;
    }
  }

  /**
   * A picture embedded in a rich-text section.
   *
   * The caller has already checked the actor may edit this document. Stored
   * as a `CONTENT_IMAGE` row: out of the file list, and — because the bytes
   * were sniffed as a raster image here — allowed to be served inline, which
   * is what an `<img>` needs.
   */
  async attachImage(
    documentId: string,
    file: UploadedFile,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<StoredFile> {
    const mimeType = assertRasterImage(file);
    const storageKey = `${randomUUID()}${RASTER_EXTENSIONS[mimeType]}`;

    await mkdir(this.uploadDir, { recursive: true });
    await writeFile(join(this.uploadDir, storageKey), file.bytes);

    try {
      const row = await this.prisma.documentFile.create({
        data: {
          documentId,
          fileName: safeDisplayName(file.originalName),
          mimeType,
          sizeBytes: file.bytes.length,
          storageKey,
          purpose: 'CONTENT_IMAGE',
          uploadedById: actor.id,
          uploadedByName: actor.email,
        },
      });

      await this.auditService.record({
        action: AUDIT_ACTIONS.DOCUMENT_FILE_UPLOADED,
        entity: 'Document',
        entityId: documentId,
        actorId: actor.id,
        actorEmail: actor.email,
        ip: client.ip,
        userAgent: client.userAgent,
        metadata: { purpose: row.purpose, fileId: row.id },
        after: {
          id: row.id,
          fileName: row.fileName,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          purpose: row.purpose,
        },
      });

      return toStored(row);
    } catch (error) {
      await unlink(join(this.uploadDir, storageKey)).catch(() => undefined);
      throw error;
    }
  }

  async list(documentId: string, actor: AuthenticatedUser): Promise<StoredFile[]> {
    const nodeId = await this.access.nodeIdOfDocument(documentId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'viewDocument');
    await this.assertNotRestricted(actor.id, documentId);

    const rows = await this.prisma.documentFile.findMany({
      // Pictures inside a section body are part of the text, not files in the
      // list — showing them there would invite deleting one out from under it.
      where: { documentId, purpose: 'ATTACHMENT' },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toStored);
  }

  /** The bytes of one file, for the download handler to stream. */
  async open(
    fileId: string,
    actor: AuthenticatedUser,
  ): Promise<{ stream: ReturnType<typeof createReadStream>; file: StoredFile; inlineImage: boolean }> {
    const row = await this.prisma.documentFile.findUnique({ where: { id: fileId } });
    if (!row) throw AppException.notFound('File');

    const nodeId = await this.access.nodeIdOfDocument(row.documentId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'viewDocument');
    await this.assertNotRestricted(actor.id, row.documentId);

    const path = resolve(this.uploadDir, row.storageKey);
    // `storageKey` is generated, so this should never trip — which is exactly
    // why it is worth asserting: the day it does, something else is wrong.
    if (!path.startsWith(this.uploadDir)) {
      this.logger.error(`Refusing to read outside the upload directory: ${row.storageKey}`);
      throw AppException.notFound('File');
    }

    return {
      stream: createReadStream(path),
      file: toStored(row),
      // Sniffed as a raster image on upload, so safe to render in place.
      inlineImage: row.purpose === 'CONTENT_IMAGE',
    };
  }

  /**
   * A restriction has to reach the bytes too.
   *
   * The node grant says this person may read documents here; the per-document
   * override says this particular one is not for them. Checking only the first
   * would leave the file downloadable by anyone who learned its id — and the
   * whole point of a restriction is that the document is not theirs to have.
   * It answers 404, matching what every list already tells them.
   */
  private async assertNotRestricted(userId: string, documentId: string): Promise<void> {
    if (await this.team.isRestricted(userId, documentId)) {
      throw AppException.notFound('Document');
    }
  }
}

/**
 * Keeps a filename printable and harmless. It is only ever shown and offered
 * as a download name; the path on disk is generated separately.
 */
function safeDisplayName(name: string): string {
  const base = name.replace(/[/\\]/g, '_').replace(/[\u0000-\u001f]/g, '');
  return base.slice(0, 200) || 'dokumen';
}

function toStored(row: {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: Date;
}): StoredFile {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedByName: row.uploadedByName,
    createdAt: row.createdAt.toISOString(),
  };
}
