-- The seeded "Implementation Document" rows become doors to the implementation
-- plan screen, as new projects already create them. A separate migration from
-- the one that adds the enum value, because PostgreSQL will not use a value
-- added in the same transaction.
--
-- Only rows nobody has written in: no template, no saved version and no file.
-- A document somebody already filled in keeps opening as that document — a
-- redirect would hide what they wrote.
UPDATE "documents" d
SET "screen" = 'IMPLEMENTATION_PLAN'::"DocumentScreen"
WHERE d."title" = 'Implementation Document'
  AND d."screen" IS NULL
  AND d."templateId" IS NULL
  AND d."deletedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "document_versions" v WHERE v."documentId" = d."id")
  AND NOT EXISTS (SELECT 1 FROM "document_files" f WHERE f."documentId" = d."id");
