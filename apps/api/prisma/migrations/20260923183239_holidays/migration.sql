-- CreateEnum
CREATE TYPE "HolidaySource" AS ENUM ('IMPORTED', 'MANUAL');

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" VARCHAR(2) NOT NULL,
    "source" "HolidaySource" NOT NULL DEFAULT 'IMPORTED',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "holidays_countryCode_date_idx" ON "holidays"("countryCode", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_countryCode_date_key" ON "holidays"("countryCode", "date");
