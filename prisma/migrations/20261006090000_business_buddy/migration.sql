-- Phase 8: AI Business Buddy.

-- Buddy chats become per person. Existing rows keep staff_id NULL
-- (pre-existing shared chats); the app shows those to owners only.
ALTER TABLE "assistant_conversations" ADD COLUMN "staff_id" TEXT;
CREATE INDEX "assistant_conversations_business_id_staff_id_updated_at_idx"
  ON "assistant_conversations"("business_id", "staff_id", "updated_at");

-- prepare → confirm → execute trail for buddy-suggested changes.
CREATE TYPE "BuddyActionStatus" AS ENUM ('PREPARED', 'APPLIED', 'DENIED', 'FAILED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "buddy_actions" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_is_owner" BOOLEAN NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "preview" JSONB,
    "status" "BuddyActionStatus" NOT NULL DEFAULT 'PREPARED',
    "error" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    CONSTRAINT "buddy_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "buddy_actions_business_id_created_at_idx" ON "buddy_actions"("business_id", "created_at");
CREATE INDEX "buddy_actions_actor_id_created_at_idx" ON "buddy_actions"("actor_id", "created_at");

ALTER TABLE "buddy_actions" ADD CONSTRAINT "buddy_actions_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
