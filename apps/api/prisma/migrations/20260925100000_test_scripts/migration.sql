-- CreateEnum
CREATE TYPE "TestScriptKind" AS ENUM ('SIT', 'UAT');

-- CreateEnum
CREATE TYPE "TestScriptStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentScreen" ADD VALUE 'SIT_SCRIPT';
ALTER TYPE "DocumentScreen" ADD VALUE 'UAT_SCRIPT';

-- CreateTable
CREATE TABLE "test_scripts" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "TestScriptKind" NOT NULL,
    "appName" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '',
    "testDate" TIMESTAMP(3),
    "environment" TEXT NOT NULL DEFAULT 'STAGING',
    "content" JSONB NOT NULL DEFAULT '[]',
    "status" "TestScriptStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "submittedById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_script_captures" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "TestScriptKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_script_captures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "test_scripts_projectId_kind_key" ON "test_scripts"("projectId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "test_script_captures_storageKey_key" ON "test_script_captures"("storageKey");

-- CreateIndex
CREATE INDEX "test_script_captures_projectId_kind_idx" ON "test_script_captures"("projectId", "kind");

-- AddForeignKey
ALTER TABLE "test_scripts" ADD CONSTRAINT "test_scripts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_script_captures" ADD CONSTRAINT "test_script_captures_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
