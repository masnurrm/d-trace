-- Row snapshots for the audit trail.
--
-- `before` holds the changed fields as they were, `after` as they became.
-- An insert has no `before`, a delete has no `after`, and an update stores
-- only the fields that actually moved.
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "before" JSONB;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "after" JSONB;
