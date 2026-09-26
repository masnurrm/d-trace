-- CreateEnum
CREATE TYPE "SignatureKind" AS ENUM ('DRAWN', 'TYPED', 'BARCODE');

-- CreateTable
CREATE TABLE "user_signatures" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "SignatureKind" NOT NULL,
    "data" TEXT,
    "font" TEXT,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_signatures_userId_key" ON "user_signatures"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_signatures_code_key" ON "user_signatures"("code");

-- AddForeignKey
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
