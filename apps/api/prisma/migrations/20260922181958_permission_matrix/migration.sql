-- CreateEnum
CREATE TYPE "TemplateComponentType" AS ENUM ('HEADER', 'INFO', 'TEXT', 'FLOW', 'TABLE', 'APPROVAL');

-- CreateEnum
CREATE TYPE "TemplateDataSource" AS ENUM ('PROJECT', 'MANUAL', 'MIXED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('ADMIN', 'MANAGER', 'COLLABORATOR', 'VIEWER');

-- CreateTable
CREATE TABLE "document_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_template_sections" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "TemplateComponentType" NOT NULL DEFAULT 'TEXT',
    "source" "TemplateDataSource" NOT NULL DEFAULT 'MANUAL',
    "binding" TEXT,
    "content" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "editable" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_template_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_role_permissions" (
    "id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,
    "updatedByEmail" TEXT,

    CONSTRAINT "project_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_code_key" ON "document_templates"("code");

-- CreateIndex
CREATE INDEX "document_templates_isActive_idx" ON "document_templates"("isActive");

-- CreateIndex
CREATE INDEX "document_templates_updatedAt_idx" ON "document_templates"("updatedAt");

-- CreateIndex
CREATE INDEX "document_template_sections_templateId_position_idx" ON "document_template_sections"("templateId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "document_template_sections_templateId_key_key" ON "document_template_sections"("templateId", "key");

-- CreateIndex
CREATE INDEX "project_role_permissions_role_idx" ON "project_role_permissions"("role");

-- CreateIndex
CREATE UNIQUE INDEX "project_role_permissions_permission_role_key" ON "project_role_permissions"("permission", "role");

-- AddForeignKey
ALTER TABLE "document_template_sections" ADD CONSTRAINT "document_template_sections_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
