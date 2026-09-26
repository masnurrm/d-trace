-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill: the seeded checklist in its standard order (DEFAULT_PROJECT_DOCUMENTS
-- at the time of writing), then every other document in the order it was made.
-- A renamed seeded document no longer matches and falls in with the rest.
WITH "defaults" ("title", "idx") AS (
  VALUES
    ('Effort Estimation (Mandays)', 0),
    ('Project Timeline', 1),
    ('Project Activity Plan', 2),
    ('Business Process Model (BPM)', 3),
    ('Business Blueprint', 4),
    ('Purchase Order (PO)', 5),
    ('Release Readiness Checklist', 6),
    ('System Integration Test (SIT) Script', 7),
    ('User Acceptance Test (UAT) Script', 8),
    ('Security Checklist', 9),
    ('Implementation Document', 10),
    ('Bug & Issue List', 11),
    ('User Manual', 12),
    ('Berita Acara Serah Terima (BAST)', 13)
),
"ranked" AS (
  SELECT
    d."id",
    ROW_NUMBER() OVER (
      PARTITION BY d."projectId"
      ORDER BY COALESCE(df."idx", 1000), d."createdAt", d."id"
    ) - 1 AS "pos"
  FROM "documents" d
  LEFT JOIN "defaults" df ON df."title" = d."title"
)
UPDATE "documents"
SET "position" = "ranked"."pos"
FROM "ranked"
WHERE "documents"."id" = "ranked"."id";

-- CreateIndex
CREATE INDEX "documents_projectId_position_idx" ON "documents"("projectId", "position");
