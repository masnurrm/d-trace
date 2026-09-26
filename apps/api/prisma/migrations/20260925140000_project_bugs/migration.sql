-- CreateEnum
CREATE TYPE "BugEnvironment" AS ENUM ('SIT', 'UAT', 'PROD');

-- CreateEnum
CREATE TYPE "BugStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING_TEST', 'IN_QA', 'DONE');

-- CreateEnum
CREATE TYPE "BugSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterTable
ALTER TABLE "implementation_plans" ADD COLUMN     "firstCompletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "project_bugs" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT,
    "environment" "BugEnvironment" NOT NULL,
    "severity" "BugSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "BugStatus" NOT NULL DEFAULT 'OPEN',
    "developerId" UUID,
    "qaId" UUID,
    "foundAt" TIMESTAMP(3) NOT NULL,
    "fixEta" TIMESTAMP(3),
    "readyForTestAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "reportedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "project_bugs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_bugs_projectId_environment_idx" ON "project_bugs"("projectId", "environment");

-- CreateIndex
CREATE INDEX "project_bugs_developerId_idx" ON "project_bugs"("developerId");

-- CreateIndex
CREATE UNIQUE INDEX "project_bugs_projectId_number_key" ON "project_bugs"("projectId", "number");

-- AddForeignKey
ALTER TABLE "project_bugs" ADD CONSTRAINT "project_bugs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_bugs" ADD CONSTRAINT "project_bugs_developerId_fkey" FOREIGN KEY ("developerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_bugs" ADD CONSTRAINT "project_bugs_qaId_fkey" FOREIGN KEY ("qaId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_bugs" ADD CONSTRAINT "project_bugs_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A plan already marked complete has already gone live: carry that over, so a
-- project that finished its cut-over before this column existed still opens
-- its bug list on Production.
UPDATE "implementation_plans"
SET "firstCompletedAt" = "completedAt"
WHERE "status" = 'COMPLETED'
  AND "completedAt" IS NOT NULL;
