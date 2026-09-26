-- The seeded SIT and UAT rows become doors to the test script screen, as new
-- projects already create them. A separate migration from the one that adds
-- the enum values, because PostgreSQL will not use a value added in the same
-- transaction.
--
-- Only rows nobody has written in: no template, no saved version and no file.
-- A document somebody already filled in keeps opening as that document — a
-- redirect would hide what they wrote.
UPDATE "documents" d
SET "screen" = CASE d."title"
    WHEN 'System Integration Test (SIT) Script' THEN 'SIT_SCRIPT'::"DocumentScreen"
    ELSE 'UAT_SCRIPT'::"DocumentScreen"
  END
WHERE d."title" IN ('System Integration Test (SIT) Script', 'User Acceptance Test (UAT) Script')
  AND d."screen" IS NULL
  AND d."templateId" IS NULL
  AND d."deletedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "document_versions" v WHERE v."documentId" = d."id")
  AND NOT EXISTS (SELECT 1 FROM "document_files" f WHERE f."documentId" = d."id");
