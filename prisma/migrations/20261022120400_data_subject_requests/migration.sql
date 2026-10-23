-- Tab 5: data-subject requests — export and erasure (additive).
--
-- 1. data_subject_requests: append-only evidence of every export produced
--    and erasure carried out (who asked, who acted, when, why, what it
--    touched). Never the exported data, never the global customer id.
-- 2. erase_membership(): the ONE write path that de-identifies a customer at
--    a business inside the identity core (CLAUDE.md: writes to identity
--    tables go through SECURITY DEFINER RPCs). The membership is revoked and
--    its display name cleared; consents at that business are revoked; if the
--    customer has no other live membership their identifiers (phone, email)
--    are deleted and the customer row de-identified. Visits are append-only
--    by trigger and hold no personal information, so they stay as counts.
--    Order/appointment/review snapshots are scrubbed by the application in
--    the same request (data-subject.service.ts).

CREATE TABLE "data_subject_requests" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "membership_public_id" UUID,
    "phone_hash" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "reason" TEXT,
    "summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "data_subject_requests_business_id_created_at_idx" ON "data_subject_requests"("business_id", "created_at");
CREATE INDEX "data_subject_requests_membership_public_id_idx" ON "data_subject_requests"("membership_public_id");

ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only, like the rest of the evidence tables.
DROP TRIGGER IF EXISTS data_subject_requests_append_only ON data_subject_requests;
CREATE TRIGGER data_subject_requests_append_only
  BEFORE UPDATE OR DELETE ON data_subject_requests
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ── erase_membership ────────────────────────────────────────
CREATE OR REPLACE FUNCTION erase_membership(
  p_business_id UUID, p_public_id UUID, p_actor_type TEXT, p_actor_id TEXT, p_reason TEXT
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_membership memberships%ROWTYPE;
  v_other_live INT;
  v_identifiers_removed INT := 0;
  v_consents_revoked INT := 0;
BEGIN
  SELECT * INTO v_membership
    FROM memberships
   WHERE business_id = p_business_id AND public_id = p_public_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership not found';
  END IF;

  -- The pairwise record stays (orders, visits and reviews still hang off it) but no longer identifies anyone.
  UPDATE memberships
     SET display_name = NULL, status = 'revoked'
   WHERE id = v_membership.id;

  UPDATE consents
     SET revoked_at = now()
   WHERE customer_id = v_membership.customer_id
     AND business_id = p_business_id
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_consents_revoked = ROW_COUNT;

  SELECT count(*) INTO v_other_live
    FROM memberships
   WHERE customer_id = v_membership.customer_id
     AND id <> v_membership.id
     AND status = 'active';

  -- No other business still has a live relationship: the person's identifiers go too.
  IF v_other_live = 0 THEN
    DELETE FROM customer_identifiers WHERE customer_id = v_membership.customer_id;
    GET DIAGNOSTICS v_identifiers_removed = ROW_COUNT;
    UPDATE customers SET display_name = NULL, language = NULL WHERE id = v_membership.customer_id;
    UPDATE consents SET revoked_at = now()
     WHERE customer_id = v_membership.customer_id AND revoked_at IS NULL;
  END IF;

  PERFORM audit_write(p_actor_type, p_actor_id, p_business_id, 'erase_membership', 'membership', v_membership.id::text, NULL);

  RETURN jsonb_build_object(
    'membership_id', v_membership.id,
    'identifiers_removed', v_identifiers_removed,
    'consents_revoked', v_consents_revoked,
    'customer_fully_erased', v_other_live = 0,
    'other_live_memberships', v_other_live
  );
END $$;

