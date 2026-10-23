-- The append-only record of phone messages, and the table the daily spend cap
-- counts (src/lib/messaging/message-log.ts).
--
-- Tab 4, notify-sms workstream. Additive: one enum, one table, nothing else
-- touched.
--
-- Deliberately absent: the recipient's number and the message body.
-- src/lib/messaging/provider.ts promises never to record either, and a table is
-- still a log. `to_masked` keeps the last three digits so support can recognise
-- a number, and `body_chars` carries what cost actually depends on. There is no
-- column that could reconstruct the message.

CREATE TYPE "MessageLogStatus" AS ENUM ('CAPPED', 'REJECTED', 'ACCEPTED', 'DELIVERED', 'UNDELIVERED');

CREATE TABLE "message_logs" (
  "id"                  TEXT NOT NULL,
  -- Null for a customer sign-in code: those are platform identity messages and
  -- are deliberately not attributed to a shop (the same phone is a separate
  -- customer row at every business and sign-in must not pick one).
  "business_id"         UUID,
  "kind"                TEXT NOT NULL,
  "provider"            TEXT NOT NULL,
  "to_masked"           TEXT NOT NULL,
  "status"              "MessageLogStatus" NOT NULL,
  "body_chars"          INTEGER NOT NULL,
  "provider_message_id" TEXT,
  "error_name"          TEXT,
  -- The provider's OWN credits, not rands. BulkSMS reports creditCost (e.g.
  -- 0.3) and does not expose what a credit was bought for, so a ZAR figure
  -- here would be invented. Not integer cents, because this is not currency.
  "cost_credits"        DECIMAL(10,4),
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reported_at"         TIMESTAMP(3),
  "delivered_at"        TIMESTAMP(3),

  CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- A delivery report arrives keyed by the provider's id. Unique so a replayed
-- report cannot be applied to two rows; Postgres permits many NULLs, which is
-- what CAPPED and most REJECTED rows carry.
CREATE UNIQUE INDEX "message_logs_provider_message_id_key"
  ON "message_logs"("provider_message_id");

-- The daily-cap count: business_id plus a created_at lower bound.
CREATE INDEX "message_logs_business_id_created_at_idx"
  ON "message_logs"("business_id", "created_at");

CREATE INDEX "message_logs_status_created_at_idx"
  ON "message_logs"("status", "created_at");

-- SET NULL, not RESTRICT: closing a business must neither destroy the record of
-- what was spent on its behalf nor be blocked by it. The other Tab 4 tables use
-- RESTRICT because they hold invoices and settlements, which must never lose
-- their counterparty; an operational send log is a different thing.
ALTER TABLE "message_logs"
  ADD CONSTRAINT "message_logs_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Cheap honesty checks: a negative length or a negative cost is a bug in the
-- caller, not a value worth storing.
ALTER TABLE "message_logs"
  ADD CONSTRAINT "message_logs_body_chars_non_negative" CHECK ("body_chars" >= 0);

ALTER TABLE "message_logs"
  ADD CONSTRAINT "message_logs_cost_non_negative" CHECK ("cost_credits" IS NULL OR "cost_credits" >= 0);
