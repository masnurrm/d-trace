-- AlterEnum
ALTER TYPE "TemplateComponentType" ADD VALUE 'DATA';

-- CreateEnum
CREATE TYPE "DocumentFilePurpose" AS ENUM ('ATTACHMENT', 'CONTENT_IMAGE');

-- AlterTable
ALTER TABLE "document_files" ADD COLUMN     "purpose" "DocumentFilePurpose" NOT NULL DEFAULT 'ATTACHMENT';
