-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "after" JSONB,
ADD COLUMN     "before" JSONB;
