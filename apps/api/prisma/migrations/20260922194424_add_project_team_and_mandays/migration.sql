-- CreateEnum
CREATE TYPE "ProjectJobRole" AS ENUM ('TL', 'PM', 'BA', 'IP_COMPLIANCE', 'IT_SECURITY', 'DEVELOPER', 'QA');

-- CreateEnum
CREATE TYPE "MandayStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "jobRole" "ProjectJobRole" NOT NULL,
    "projectRole" "ProjectRole" NOT NULL DEFAULT 'COLLABORATOR',
    "addedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_permissions" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canCreate" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manday_plans" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "module" TEXT,
    "pic" TEXT,
    "estimatedAt" TIMESTAMP(3),
    "roles" "ProjectJobRole"[],
    "status" "MandayStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "submittedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "decisionNote" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manday_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manday_tasks" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "stage" "ProjectStage" NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "MandayStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manday_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manday_efforts" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "jobRole" "ProjectJobRole" NOT NULL,
    "days" DECIMAL(6,1) NOT NULL DEFAULT 0,

    CONSTRAINT "manday_efforts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_members_userId_idx" ON "project_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_projectId_userId_key" ON "project_members"("projectId", "userId");

-- CreateIndex
CREATE INDEX "document_permissions_userId_idx" ON "document_permissions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "document_permissions_documentId_userId_key" ON "document_permissions"("documentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "manday_plans_projectId_key" ON "manday_plans"("projectId");

-- CreateIndex
CREATE INDEX "manday_tasks_planId_stage_position_idx" ON "manday_tasks"("planId", "stage", "position");

-- CreateIndex
CREATE UNIQUE INDEX "manday_efforts_taskId_jobRole_key" ON "manday_efforts"("taskId", "jobRole");

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manday_plans" ADD CONSTRAINT "manday_plans_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manday_tasks" ADD CONSTRAINT "manday_tasks_planId_fkey" FOREIGN KEY ("planId") REFERENCES "manday_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manday_efforts" ADD CONSTRAINT "manday_efforts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "manday_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
