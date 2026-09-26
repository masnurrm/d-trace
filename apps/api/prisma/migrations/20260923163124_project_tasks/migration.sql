-- CreateEnum
CREATE TYPE "DevStatus" AS ENUM ('UNREADY', 'WAITING_CONFIRM_USER', 'READY', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('REOPENED', 'WAITING_DEVELOPMENT', 'READY', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "project_tasks" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "module" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT NOT NULL,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" UUID,
    "devPlanStart" TIMESTAMP(3),
    "devPlanEnd" TIMESTAMP(3),
    "devActualStart" TIMESTAMP(3),
    "devActualEnd" TIMESTAMP(3),
    "devCompletion" INTEGER NOT NULL DEFAULT 0,
    "devStatus" "DevStatus" NOT NULL DEFAULT 'UNREADY',
    "testPlanStart" TIMESTAMP(3),
    "testPlanEnd" TIMESTAMP(3),
    "testActualStart" TIMESTAMP(3),
    "testActualEnd" TIMESTAMP(3),
    "testCompletion" INTEGER NOT NULL DEFAULT 0,
    "testStatus" "TestStatus" NOT NULL DEFAULT 'WAITING_DEVELOPMENT',
    "remark" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_tasks_projectId_position_idx" ON "project_tasks"("projectId", "position");

-- CreateIndex
CREATE INDEX "project_tasks_projectId_devStatus_idx" ON "project_tasks"("projectId", "devStatus");

-- CreateIndex
CREATE INDEX "project_tasks_projectId_testStatus_idx" ON "project_tasks"("projectId", "testStatus");

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
