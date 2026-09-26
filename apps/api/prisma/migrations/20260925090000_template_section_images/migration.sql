-- AlterTable
ALTER TABLE "document_template_sections" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "document_template_assets" (
    "id" UUID NOT NULL,
    "templateId" UUID,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_template_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_template_assets_storageKey_key" ON "document_template_assets"("storageKey");

-- CreateIndex
CREATE INDEX "document_template_assets_templateId_idx" ON "document_template_assets"("templateId");

-- AddForeignKey
ALTER TABLE "document_template_assets" ADD CONSTRAINT "document_template_assets_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
