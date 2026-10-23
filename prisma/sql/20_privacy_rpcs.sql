-- Tab 5 privacy RPC — human-readable copy of prisma/migrations/20261022120400_data_subject_requests
-- (the migration is canonical; if you change one, change both). Apply AFTER the identity RPCs.

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

