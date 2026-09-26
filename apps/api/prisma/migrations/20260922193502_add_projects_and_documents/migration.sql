-- CreateEnum
CREATE TYPE "ProjectStage" AS ENUM ('PREPARE', 'DEFINE', 'DESIGN', 'DEVELOP', 'DEPLOY', 'COMPLETE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ON_PROGRESS', 'ON_HOLD', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'ON_PROGRESS', 'REVIEW', 'FINAL');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nodeId" UUID NOT NULL,
    "stage" "ProjectStage" NOT NULL DEFAULT 'PREPARE',
    "status" "ProjectStatus" NOT NULL DEFAULT 'ON_PROGRESS',
    "description" TEXT,
    "startsAt" TIMESTAMP(3),
    "goLiveAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "templateId" UUID,
    "stage" "ProjectStage" NOT NULL DEFAULT 'PREPARE',
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" UUID,
    "ownerName" TEXT,
    "content" JSONB NOT NULL DEFAULT '{}',
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_favorites" (
    "userId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_favorites_pkey" PRIMARY KEY ("userId","documentId")
);

-- CreateIndex
CREATE INDEX "projects_nodeId_updatedAt_idx" ON "projects"("nodeId", "updatedAt");

-- CreateIndex
CREATE INDEX "projects_stage_idx" ON "projects"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "projects_nodeId_code_key" ON "projects"("nodeId", "code");

-- CreateIndex
CREATE INDEX "documents_projectId_updatedAt_idx" ON "documents"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "documents_deletedAt_updatedAt_idx" ON "documents"("deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "documents_templateId_idx" ON "documents"("templateId");

-- CreateIndex
CREATE INDEX "document_favorites_userId_createdAt_idx" ON "document_favorites"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_favorites" ADD CONSTRAINT "document_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_favorites" ADD CONSTRAINT "document_favorites_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
