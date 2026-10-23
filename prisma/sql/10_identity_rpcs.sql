-- Apply AFTER `prisma db push` (tables exist). Append-only triggers + the 4
-- SECURITY DEFINER RPCs the customer service calls.
--
-- ⚠️ FIRST-CUT: RLS policies + the non-BYPASSRLS `app_runtime` role + column
-- grants are DEFERRED (they need the SET LOCAL tenant-context wiring in the API,
-- which lands with M1 auth). The full hardened version is prisma/sql/identity_layer.sql.
-- Until then, isolation is app-layer (business-scoped Prisma client + API). Do NOT
-- put real customer data in before RLS is enabled.
--
-- Canonical copy now lives at prisma/migrations/20260809000001_identity_rpcs/
-- migration.sql (tracked, applied to the real dev DB via `migrate resolve
-- --applied`). This file is kept as the human-readable source; if you
-- change one, change both.
--
-- log_visit/redeem_reward below reflect the idempotency-key + advisory-
-- lock update from prisma/migrations/20260902170000_loyalty_idempotency_rpcs
-- (applied via a real `migrate deploy`, not resolve — this changed the
-- live function bodies, not just recorded history for objects that
-- already existed).
--
-- register_customer below also reflects the p_email/p_consent_marketing
-- addition from prisma/migrations/20260912000000_customer_consent_email —
-- two new TRAILING, DEFAULTED parameters. That migration DROPs the old
-- 6-arg register_customer explicitly first: CREATE OR REPLACE FUNCTION
-- does not replace a function whose parameter list changed (Postgres
-- treats it as a new overload), which left both signatures resolvable
-- and every existing 6-arg call site ambiguous until the drop was added.

-- ── Append-only enforcement ─────────────────────────────────
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS visits_append_only ON visits;
CREATE TRIGGER visits_append_only
  BEFORE UPDATE OR DELETE ON visits
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS audit_append_only ON audit_log;
CREATE TRIGGER audit_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION consents_revoke_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consents is append-only (revoke by setting revoked_at)';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.evidence IS DISTINCT FROM OLD.evidence
     OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'consents rows may only set revoked_at once';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS consents_revoke_only ON consents;
CREATE TRIGGER consents_revoke_only
  BEFORE UPDATE OR DELETE ON consents
  FOR EACH ROW EXECUTE FUNCTION consents_revoke_only();

-- ── audit helper ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit_write(
  p_actor_type TEXT, p_actor_id TEXT, p_business_id UUID,
  p_action TEXT, p_object_type TEXT, p_object_id TEXT, p_ip TEXT
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO audit_log (actor_type, actor_id, business_id, action, object_type, object_id, ip)
  VALUES (p_actor_type, p_actor_id, p_business_id, p_action, p_object_type, p_object_id, p_ip);
$$;

-- ── register_customer ───────────────────────────────────────
DROP FUNCTION IF EXISTS register_customer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION register_customer(
  p_business_id UUID, p_phone TEXT, p_display_name TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'owner_dashboard',
  p_actor_id TEXT DEFAULT NULL, p_ip TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_consent_marketing BOOLEAN DEFAULT FALSE
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_membership memberships%ROWTYPE;
  v_customer_id UUID;
  v_code TEXT;
  v_created BOOLEAN := FALSE;
  v_attempts INT := 0;
BEGIN
  IF p_phone !~ '^\+27[678]\d{8}$' THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text || p_phone, 0));

  SELECT m.* INTO v_membership
  FROM memberships m
  JOIN customer_identifiers ci ON ci.customer_id = m.customer_id
  WHERE m.business_id = p_business_id
    AND ci.type = 'phone' AND ci.value = p_phone
  LIMIT 1;

  IF NOT FOUND THEN
    v_created := TRUE;
    INSERT INTO customers (display_name) VALUES (p_display_name)
    RETURNING id INTO v_customer_id;

    INSERT INTO customer_identifiers (customer_id, type, value, source, is_primary)
    VALUES (v_customer_id, 'phone', p_phone, p_source, TRUE);

    LOOP
      v_attempts := v_attempts + 1;
      v_code := generate_short_code();
      BEGIN
        INSERT INTO memberships (customer_id, business_id, short_code, display_name)
        VALUES (v_customer_id, p_business_id, v_code, p_display_name)
        RETURNING * INTO v_membership;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_attempts >= 5 THEN RAISE; END IF;
      END;
    END LOOP;

    INSERT INTO consents (customer_id, business_id, purpose, source, evidence)
    VALUES (v_customer_id, p_business_id, 'loyalty_program', p_source,
            jsonb_build_object('registered_by', p_source));
  ELSE
    v_customer_id := v_membership.customer_id;
    UPDATE memberships SET last_seen = NOW(),
      display_name = COALESCE(memberships.display_name, p_display_name)
    WHERE id = v_membership.id
    RETURNING * INTO v_membership;
  END IF;

  IF p_email IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM customer_identifiers WHERE customer_id = v_customer_id AND type = 'email'
  ) THEN
    INSERT INTO customer_identifiers (customer_id, type, value, source, is_primary)
    VALUES (v_customer_id, 'email', p_email, p_source, FALSE);
  END IF;

  IF p_consent_marketing THEN
    INSERT INTO consents (customer_id, business_id, purpose, source, evidence)
    VALUES (v_customer_id, p_business_id, 'marketing', p_source,
            jsonb_build_object('registered_by', p_source));
  END IF;

  PERFORM audit_write('business_owner', p_actor_id, p_business_id,
    'register_customer', 'membership', v_membership.id::text, p_ip);

  RETURN jsonb_build_object(
    'public_id', v_membership.public_id,
    'short_code', v_membership.short_code,
    'display_name', v_membership.display_name,
    'created', v_created
  );
END $$;

-- ── log_visit ───────────────────────────────────────────────
-- p_idempotency_key: optional. A matching (business_id, idempotency_key)
-- already recorded means this exact request already succeeded — the
-- existing row's result is returned rather than a second visit being
-- inserted. This protects against a genuinely retried request; it is NOT
-- what prevents two concurrent-but-distinct actors from both stamping —
-- there's no lock here because two real stamps close together are two
-- real stamps, not a bug (contrast with redeem_reward below).
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

-- ── redeem_reward ───────────────────────────────────────────
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

-- ── lookup_membership ───────────────────────────────────────
CREATE OR REPLACE FUNCTION lookup_membership(
  p_business_id UUID, p_phone TEXT,
  p_actor_id TEXT DEFAULT NULL, p_ip TEXT DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_membership memberships%ROWTYPE;
  v_stamps INT; v_redeems INT;
BEGIN
  PERFORM audit_write('business_owner', p_actor_id, p_business_id,
    'lookup_by_phone', 'phone', right(p_phone, 4), p_ip);

  SELECT m.* INTO v_membership
  FROM memberships m
  JOIN customer_identifiers ci ON ci.customer_id = m.customer_id
  WHERE m.business_id = p_business_id AND ci.type = 'phone' AND ci.value = p_phone
    AND m.status = 'active'
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*) FILTER (WHERE kind = 'stamp'), count(*) FILTER (WHERE kind = 'redeem')
  INTO v_stamps, v_redeems FROM visits WHERE membership_id = v_membership.id;

  RETURN jsonb_build_object('public_id', v_membership.public_id, 'short_code', v_membership.short_code,
    'display_name', v_membership.display_name, 'stamps', v_stamps, 'redeems', v_redeems);
END $$;

-- ── set_channel_consent ─────────────────────────────────────
-- Per-channel order-message consent (purpose order_updates): grants at
-- checkout, STOP / START from the WhatsApp webhook. Full notes in
-- prisma/migrations/20261022142000_channel_consent_rpc/migration.sql.
CREATE OR REPLACE FUNCTION set_channel_consent(
  p_phone TEXT, p_channel TEXT, p_purpose TEXT, p_granted BOOLEAN,
  p_source TEXT, p_evidence JSONB DEFAULT '{}'::jsonb,
  p_business_id UUID DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_memberships INT := 0;
  m RECORD;
BEGIN
  IF p_phone !~ '^\+27[678]\d{8}$' THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  IF p_channel NOT IN ('whatsapp', 'sms', 'email') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;
  IF p_purpose NOT IN ('order_updates', 'marketing') THEN
    RAISE EXCEPTION 'invalid_purpose';
  END IF;
  IF p_source IS NULL OR p_source = '' THEN
    RAISE EXCEPTION 'source_required';
  END IF;

  FOR m IN
    SELECT DISTINCT mb.customer_id, mb.business_id
    FROM customer_identifiers ci
    JOIN memberships mb ON mb.customer_id = ci.customer_id
    WHERE ci.type = 'phone' AND ci.value = p_phone
      AND mb.status = 'active'
      AND (p_business_id IS NULL OR mb.business_id = p_business_id)
  LOOP
    v_memberships := v_memberships + 1;
    IF p_granted THEN
      INSERT INTO consents (customer_id, business_id, purpose, channel, source, evidence)
      VALUES (m.customer_id, m.business_id, p_purpose, p_channel, p_source, p_evidence);
    ELSE
      UPDATE consents SET revoked_at = NOW()
      WHERE customer_id = m.customer_id AND business_id = m.business_id
        AND purpose = p_purpose AND channel = p_channel AND revoked_at IS NULL;
      INSERT INTO consents (customer_id, business_id, purpose, channel, granted_at, revoked_at, source, evidence)
      VALUES (m.customer_id, m.business_id, p_purpose, p_channel, NOW(), NOW(), p_source, p_evidence);
    END IF;
    PERFORM audit_write('customer', NULL, m.business_id,
      CASE WHEN p_granted THEN 'channel_consent_granted' ELSE 'channel_consent_withdrawn' END,
      'consent', p_purpose || ':' || p_channel, NULL);
  END LOOP;

  RETURN jsonb_build_object('memberships', v_memberships);
END $$;

-- Privileges (migration 20261022142100): EXECUTE defaults to PUBLIC on new
-- functions, so PUBLIC is revoked and the runtime role granted explicitly.
REVOKE EXECUTE ON FUNCTION public.set_channel_consent(text, text, text, boolean, text, jsonb, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_channel_consent(text, text, text, boolean, text, jsonb, uuid) TO neondb_owner;
