-- AlterTable
ALTER TABLE "manday_tasks" ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "progressPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startsAt" TIMESTAMP(3);
