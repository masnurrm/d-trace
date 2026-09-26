import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUDIT_ACTIONS, type TemplateAssetView } from '@dtrace/shared';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/exceptions/app.exception.js';
import {
  RASTER_EXTENSIONS,
  assertRasterImage,
  safeDisplayName,
  type RasterUpload,
} from '../../common/utils/raster-image.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Subdirectory of `UPLOAD_DIR`, so template images never mix with document files. */
const SUBDIR = 'template-assets';

export type TemplateImageUpload = RasterUpload;

const ASSET_SELECT = {
  id: true,
  templateId: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  storageKey: true,
  uploadedById: true,
  createdAt: true,
} as const;

/**
 * Images attached to template sections.
 *
 * Uploaded one at a time, before the template is saved: the builder saves the
 * whole template as one JSON payload, and bytes do not belong in it. A section
 * then refers to the asset by id.
 *
 * These are served **inline** — they are pictures on a page — which is why the
 * type allow-list is raster only and the bytes must agree with the declared
 * type. An SVG, or HTML that claims to be a PNG, never gets stored.
 */
@Injectable()
export class TemplateAssetService {
  private readonly logger = new Logger(TemplateAssetService.name);
  private readonly dir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.dir = resolve(config.get('upload', { infer: true }).dir, SUBDIR);
  }

  async upload(
    templateId: string,
    file: TemplateImageUpload,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<TemplateAssetView> {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id: templateId },
      select: { id: true },
    });
    if (!template) throw AppException.notFound('Document template');

    const mimeType = assertRasterImage(file);
    const storageKey = `${randomUUID()}${RASTER_EXTENSIONS[mimeType]}`;

    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, storageKey), file.bytes);

    try {
      const row = await this.prisma.documentTemplateAsset.create({
        data: {
          templateId,
          fileName: safeDisplayName(file.originalName),
          mimeType,
          sizeBytes: file.bytes.length,
          storageKey,
          uploadedById: actor.id,
        },
        select: ASSET_SELECT,
      });

      await this.auditService.record({
        action: AUDIT_ACTIONS.DOCUMENT_TEMPLATE_ASSET_UPLOADED,
        entity: 'DocumentTemplateAsset',
        entityId: row.id,
        actorId: actor.id,
        actorEmail: actor.email,
        ip: client.ip,
        userAgent: client.userAgent,
        after: row,
      });

      return toView(row);
    } catch (error) {
      // No row, no file: an orphan on disk is litter nobody will ever find.
      await unlink(join(this.dir, storageKey)).catch(() => undefined);
      throw error;
    }
  }

  /** The bytes of one image, for the controller to stream. */
  async open(
    assetId: string,
  ): Promise<{ stream: ReturnType<typeof createReadStream>; asset: TemplateAssetView }> {
    const row = await this.prisma.documentTemplateAsset.findUnique({
      where: { id: assetId },
      select: ASSET_SELECT,
    });
    if (!row) throw AppException.notFound('Image');

    const path = resolve(this.dir, row.storageKey);
    // `storageKey` is generated, so this should never trip; the day it does,
    // something else is wrong and reading on would be the second mistake.
    if (!path.startsWith(this.dir)) {
      this.logger.error(`Refusing to read outside the asset directory: ${row.storageKey}`);
      throw AppException.notFound('Image');
    }

    return { stream: createReadStream(path), asset: toView(row) };
  }

  /** Ids in `assetIds` that do not exist — a section may only point at a real image. */
  async missing(assetIds: string[]): Promise<string[]> {
    const unique = [...new Set(assetIds)];
    if (unique.length === 0) return [];

    const found = await this.prisma.documentTemplateAsset.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    const known = new Set(found.map((row) => row.id));
    return unique.filter((id) => !known.has(id));
  }
}

function toView(row: {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}): TemplateAssetView {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}
