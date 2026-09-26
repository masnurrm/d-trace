-- CreateEnum
CREATE TYPE "ImplementationPlanStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- AlterEnum
ALTER TYPE "DocumentScreen" ADD VALUE 'IMPLEMENTATION_PLAN';

-- CreateTable
CREATE TABLE "implementation_plans" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "serviceName" TEXT NOT NULL DEFAULT '',
    "implementationDate" TIMESTAMP(3),
    "startTime" TEXT NOT NULL DEFAULT '22:00',
    "hosts" JSONB NOT NULL DEFAULT '[]',
    "content" JSONB NOT NULL DEFAULT '[]',
    "status" "ImplementationPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "implementation_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "implementation_plans_projectId_key" ON "implementation_plans"("projectId");

-- AddForeignKey
ALTER TABLE "implementation_plans" ADD CONSTRAINT "implementation_plans_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
