-- One outstanding invitation per address.
--
-- A partial index, not a plain unique one: an address may accumulate any
-- number of ACCEPTED, EXPIRED or REVOKED rows over time — that is the history
-- — but only ever one PENDING. This is what makes the duplicate impossible
-- rather than merely unlikely, because the service's own check and the insert
-- are two statements that two concurrent requests can interleave between.
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_email_pending_key"
  ON "invitations" ("email")
  WHERE "status" = 'PENDING';
