import {
  TEMPLATE_IMAGE_MAX_BYTES,
  TEMPLATE_IMAGE_MIME_TYPES,
  type TemplateImageMimeType,
} from '@dtrace/shared';
import { AppException } from '../exceptions/app.exception.js';

/**
 * The one gate for images this API serves **inline**: template pictures and
 * test-scenario screenshots.
 *
 * Inline is what makes the check matter. The declared type comes from the
 * client and is a claim, not a fact, so the bytes must agree with it: HTML
 * renamed to `logo.png` fails here instead of reaching a reader's browser, and
 * SVG — which can carry script — is never on the list.
 */

export const RASTER_EXTENSIONS: Record<TemplateImageMimeType, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export interface RasterUpload {
  originalName: string;
  mimeType: string;
  bytes: Buffer;
}

export function assertRasterImage(file: RasterUpload): TemplateImageMimeType {
  if (file.bytes.length === 0) {
    throw AppException.validation([{ field: 'file', message: 'Berkas kosong' }]);
  }

  if (file.bytes.length > TEMPLATE_IMAGE_MAX_BYTES) {
    throw new AppException(
      'PAYLOAD_TOO_LARGE',
      `Gambar melebihi batas ${TEMPLATE_IMAGE_MAX_BYTES / 1024 / 1024} MB`,
      413,
    );
  }

  const declared = (TEMPLATE_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimeType)
    ? (file.mimeType as TemplateImageMimeType)
    : null;

  if (!declared || sniffRaster(file.bytes) !== declared) {
    throw AppException.validation([
      { field: 'file', message: 'Hanya gambar PNG, JPG, GIF, atau WEBP yang didukung' },
    ]);
  }

  return declared;
}

function sniffRaster(bytes: Buffer): TemplateImageMimeType | null {
  const starts = (signature: number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);

  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  // RIFF....WEBP
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** The uploaded name, made safe to show and to put in a header. */
export function safeDisplayName(name: string, fallback = 'gambar'): string {
  const base = name.replace(/[/\\]/g, '_').replace(/[\u0000-\u001f]/g, '');
  return base.slice(0, 200) || fallback;
}
