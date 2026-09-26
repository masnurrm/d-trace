import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ROLES,
  TEMPLATE_IMAGE_MAX_BYTES,
  createDocumentTemplateSchema,
  idSchema,
  listDocumentTemplatesQuerySchema,
  templateCodeSchema,
  updateDocumentTemplateSchema,
  type CreateDocumentTemplateInput,
  type ListDocumentTemplatesQuery,
  type UpdateDocumentTemplateInput,
} from '@dtrace/shared';
import { z } from 'zod';
import { Client, type ClientInfo } from '../../common/decorators/client-info.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { MinRole } from '../../common/decorators/roles.decorator.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AppException } from '../../common/exceptions/app.exception.js';
import { DocumentTemplatesService } from './document-templates.service.js';
import { TemplateAssetService } from './template-asset.service.js';

const duplicateTemplateSchema = z.object({
  code: templateCodeSchema,
  name: z.string().trim().min(3, 'Nama minimal 3 karakter').max(120),
});

type DuplicateTemplateInput = z.infer<typeof duplicateTemplateSchema>;

/**
 * Reading a template is open from AUDITOR up — it is the shape every document
 * produced from it will have, so an auditor needs to see it. Designing one is
 * ADMIN only.
 */
@ApiTags('document-templates')
@Controller('document-templates')
@MinRole(ROLES.AUDITOR)
export class DocumentTemplatesController {
  constructor(
    private readonly templatesService: DocumentTemplatesService,
    private readonly assets: TemplateAssetService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List document templates' })
  list(@Query(zodPipe(listDocumentTemplatesQuerySchema)) query: ListDocumentTemplatesQuery) {
    return this.templatesService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One template with its full section list' })
  findOne(@Param('id', zodPipe(idSchema)) id: string) {
    return this.templatesService.findById(id);
  }

  @Post()
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Create an empty template' })
  create(
    @Body(zodPipe(createDocumentTemplateSchema)) body: CreateDocumentTemplateInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.templatesService.create(body, actor, client);
  }

  @Post(':id/duplicate')
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Copy a template, sections included' })
  duplicate(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(duplicateTemplateSchema)) body: DuplicateTemplateInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.templatesService.duplicate(id, body.code, body.name, actor, client);
  }

  @Put(':id')
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Replace a template and its whole section list' })
  update(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(updateDocumentTemplateSchema)) body: UpdateDocumentTemplateInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.templatesService.update(id, body, actor, client);
  }

  @Delete(':id')
  @MinRole(ROLES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a template and its sections' })
  async remove(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.templatesService.remove(id, actor, client);
  }

  /* ---------------------------------------------------------------- */
  /* Section images                                                    */
  /* ---------------------------------------------------------------- */

  @Post(':id/assets')
  @MinRole(ROLES.ADMIN)
  // Multer stops reading one byte past the cap, so an oversized body is never
  // buffered whole; the service repeats the check with a readable message.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TEMPLATE_IMAGE_MAX_BYTES + 1 } }))
  @ApiOperation({ summary: 'Upload an image for use in a template section' })
  uploadAsset(
    @Param('id', zodPipe(idSchema)) id: string,
    @UploadedFile() file: MultipartFile | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    if (!file) {
      throw AppException.validation([{ field: 'file', message: 'Gambar wajib dilampirkan' }]);
    }

    return this.assets.upload(
      id,
      { originalName: file.originalname, mimeType: file.mimetype, bytes: file.buffer },
      actor,
      client,
    );
  }

  /**
   * Open to every signed-in account, not just AUDITOR up: a template's images
   * print inside every document built from it, and the people filling those
   * documents in are exactly who needs to see them.
   */
  @Get('assets/:assetId')
  @MinRole(ROLES.VIEWER)
  @ApiOperation({ summary: 'One template image' })
  async readAsset(
    @Param('assetId', zodPipe(idSchema)) assetId: string,
    @Res() response: Response,
  ): Promise<void> {
    const { stream, asset } = await this.assets.open(assetId);

    // Inline because it is a picture on a page. Safe because only sniffed
    // raster types are ever stored, and `nosniff` keeps the browser from
    // second-guessing the type it is told.
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Content-Length', String(asset.sizeBytes));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
    );

    stream.pipe(response);
  }
}

/** What `FileInterceptor` hands back. */
interface MultipartFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
