-- Adds idempotency-key support to log_visit and an advisory lock plus
-- idempotency-key support to redeem_reward. CREATE OR REPLACE FUNCTION is
-- safe to re-run — this only changes the two functions' bodies/signatures
-- (new DEFAULT NULL parameter, so every existing caller keeps working
-- unchanged), no table DDL.
--
-- Canonical copy also kept at prisma/sql/10_identity_rpcs.sql (the
-- human-readable source) — keep both in sync.

CREATE OR REPLACE FUNCTION log_visit(
  p_business_id UUID, p_public_id UUID, p_kind TEXT DEFAULT 'stamp',
  p_actor_id TEXT DEFAULT NULL, p_idempotency_key TEXT DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_membership memberships%ROWTYPE;
  v_stamps INT; v_redeems INT;
  v_existing_visit_id UUID;
BEGIN
  IF p_kind NOT IN ('visit','stamp') THEN
    RAISE EXCEPTION 'invalid_kind';
  END IF;

  SELECT * INTO v_membership FROM memberships
  WHERE public_id = p_public_id AND business_id = p_business_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'membership_not_found'; END IF;

  -- Idempotent replay: a matching key already recorded means this exact
  -- request already succeeded — return the same result, don't insert again.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_visit_id FROM visits
    WHERE business_id = p_business_id AND idempotency_key = p_idempotency_key;
  END IF;

  IF v_existing_visit_id IS NULL THEN
    BEGIN
      INSERT INTO visits (membership_id, business_id, kind, idempotency_key)
      VALUES (v_membership.id, p_business_id, p_kind, p_idempotency_key);
    EXCEPTION WHEN unique_violation THEN
      -- Lost a race against another call with the same key between the
      -- SELECT above and this INSERT — that other call's row is now the
      -- record of truth; fall through and read the resulting counts
      -- normally below rather than erroring.
      NULL;
    END;
    UPDATE memberships SET last_seen = NOW() WHERE id = v_membership.id;

    PERFORM audit_write('business_owner', p_actor_id, p_business_id,
      'log_' || p_kind, 'membership', v_membership.id::text, NULL);
  END IF;

  SELECT count(*) FILTER (WHERE kind = 'stamp'), count(*) FILTER (WHERE kind = 'redeem')
  INTO v_stamps, v_redeems FROM visits WHERE membership_id = v_membership.id;

  RETURN jsonb_build_object('public_id', v_membership.public_id, 'stamps', v_stamps, 'redeems', v_redeems);
END $$;

CREATE OR REPLACE FUNCTION redeem_reward(
  p_business_id UUID, p_public_id UUID, p_actor_id TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_membership memberships%ROWTYPE;
  v_required INT; v_stamps INT; v_redeems INT;
  v_existing_visit_id UUID;
BEGIN
  SELECT * INTO v_membership FROM memberships
  WHERE public_id = p_public_id AND business_id = p_business_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'membership_not_found'; END IF;

  -- Idempotent replay check before the lock — if this exact request
  -- already succeeded, return the same result without contending for it.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_visit_id FROM visits
    WHERE business_id = p_business_id AND idempotency_key = p_idempotency_key;
  END IF;

  IF v_existing_visit_id IS NULL THEN
    -- Serializes concurrent redeem_reward calls for the SAME membership —
    -- closes the Read-Committed race where two calls could both read the
    -- pre-redeem stamp count, both pass the "enough stamps" check, and
    -- both insert a redeem row. Same pattern register_customer already
    -- uses (pg_advisory_xact_lock), a different salt so the two lock
    -- namespaces never collide.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text || p_public_id::text, 1));

    SELECT COALESCE((config->>'loyalty_stamps_required')::int, 10)
    INTO v_required FROM businesses WHERE id = p_business_id;

    SELECT count(*) FILTER (WHERE kind = 'stamp'), count(*) FILTER (WHERE kind = 'redeem')
    INTO v_stamps, v_redeems FROM visits WHERE membership_id = v_membership.id;

    IF v_stamps - (v_redeems * v_required) < v_required THEN
      RAISE EXCEPTION 'not_enough_stamps';
    END IF;

    INSERT INTO visits (membership_id, business_id, kind, idempotency_key)
    VALUES (v_membership.id, p_business_id, 'redeem', p_idempotency_key);

    PERFORM audit_write('business_owner', p_actor_id, p_business_id,
      'redeem', 'membership', v_membership.id::text, NULL);

    v_redeems := v_redeems + 1;
  ELSE
    SELECT COALESCE((config->>'loyalty_stamps_required')::int, 10)
    INTO v_required FROM businesses WHERE id = p_business_id;
    SELECT count(*) FILTER (WHERE kind = 'stamp'), count(*) FILTER (WHERE kind = 'redeem')
    INTO v_stamps, v_redeems FROM visits WHERE membership_id = v_membership.id;
  END IF;

  RETURN jsonb_build_object('public_id', v_membership.public_id,
    'stamps', v_stamps, 'redeems', v_redeems, 'required', v_required);
END $$;
