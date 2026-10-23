-- B8/B9: a hostname is attached to the hosting project only after ownership
-- is proven, and only the row that attached it may detach it.
ALTER TABLE "business_domains" ADD COLUMN "provider_attached" BOOLEAN NOT NULL DEFAULT false;

-- Backfill conservatively. Rows whose ownership was proven were attached by
-- this platform's own flow; mark them ours so removing them still detaches.
-- Unproven rows stay false: under the old flow they were attached before any
-- proof (possibly a hostname already on the project), so they must never be
-- auto-detached — audit any such attachments by hand (see the remediation report).
UPDATE "business_domains"
SET "provider_attached" = true
WHERE "provider_id" IS NOT NULL
  AND "ownership_status" = 'VERIFIED';
