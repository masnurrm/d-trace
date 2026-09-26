-- CreateEnum
CREATE TYPE "DocumentScreen" AS ENUM ('MANDAYS', 'TIMELINE', 'TASKS', 'BUGS');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "screen" "DocumentScreen";
