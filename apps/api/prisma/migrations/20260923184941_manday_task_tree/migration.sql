-- AlterTable
ALTER TABLE "manday_tasks" ADD COLUMN     "parentId" UUID;

-- CreateIndex
CREATE INDEX "manday_tasks_parentId_idx" ON "manday_tasks"("parentId");

-- AddForeignKey
ALTER TABLE "manday_tasks" ADD CONSTRAINT "manday_tasks_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "manday_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
