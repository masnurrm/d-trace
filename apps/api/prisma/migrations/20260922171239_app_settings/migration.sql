-- CreateEnum
CREATE TYPE "FooterAlign" AS ENUM ('LEFT', 'CENTER', 'RIGHT');

-- CreateEnum
CREATE TYPE "MarqueeKind" AS ENUM ('TEXT', 'LINK');

-- CreateEnum
CREATE TYPE "SmtpEncryption" AS ENUM ('NONE', 'STARTTLS', 'SSL_TLS');

-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "appName" TEXT NOT NULL DEFAULT 'D-Trace',
    "tagline" TEXT,
    "footerText" TEXT,
    "footerAlign" "FooterAlign" NOT NULL DEFAULT 'CENTER',
    "footerShowAppName" BOOLEAN NOT NULL DEFAULT true,
    "footerShowVersion" BOOLEAN NOT NULL DEFAULT true,
    "marqueeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "marqueeSpeedSeconds" INTEGER NOT NULL DEFAULT 15,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpEncryption" "SmtpEncryption" NOT NULL DEFAULT 'STARTTLS',
    "smtpUsername" TEXT,
    "smtpPassword" TEXT,
    "mailFromName" TEXT,
    "mailFromEmail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marquee_items" (
    "id" UUID NOT NULL,
    "settingId" TEXT NOT NULL DEFAULT 'singleton',
    "kind" "MarqueeKind" NOT NULL DEFAULT 'TEXT',
    "text" TEXT NOT NULL,
    "url" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marquee_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marquee_items_settingId_position_idx" ON "marquee_items"("settingId", "position");

-- CreateIndex
CREATE INDEX "marquee_items_startsAt_endsAt_idx" ON "marquee_items"("startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "marquee_items" ADD CONSTRAINT "marquee_items_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "app_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
