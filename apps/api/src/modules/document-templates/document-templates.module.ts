import { Module } from '@nestjs/common';
import { DocumentTemplatesController } from './document-templates.controller.js';
import { DocumentTemplatesService } from './document-templates.service.js';
import { TemplateAssetService } from './template-asset.service.js';

/** Master document templates: the blueprints documents are produced from. */
@Module({
  controllers: [DocumentTemplatesController],
  providers: [DocumentTemplatesService, TemplateAssetService],
  exports: [DocumentTemplatesService],
})
export class DocumentTemplatesModule {}
