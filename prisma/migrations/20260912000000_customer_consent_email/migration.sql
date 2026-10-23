-- Extends register_customer with two new TRAILING, DEFAULTED parameters —
-- p_email and p_consent_marketing — so every existing caller (stampByPhone,
-- storefront order/booking checkout as it stood before this pass) keeps
-- working completely unchanged, getting no email and no marketing consent
-- by default. CREATE OR REPLACE FUNCTION only changes this one function's
-- signature/body, no table DDL.
--
-- p_email: inserted as a customer_identifiers row (type = 'email') only if
-- the customer doesn't already have one — never overwrites an existing
-- identifier from a different source.
--
-- p_consent_marketing: always a fresh INSERT into consents (purpose =
-- 'marketing') when true, for both new and returning customers — consents
-- is an append-only/revoke-only ledger (see consents_revoke_only trigger),
-- so re-affirming consent on a later order is a new row, not an update.
-- The existing auto-granted 'loyalty_program' consent on first
-- registration is untouched.
--
-- Canonical copy also kept at prisma/sql/10_identity_rpcs.sql (the
-- human-readable source) — keep both in sync.
--
-- CREATE OR REPLACE FUNCTION does NOT replace a function whose parameter
-- list changed — Postgres treats a different arg count/types as a new
-- overload, silently leaving the old 6-arg register_customer in place
-- alongside this new 8-arg one. That made every existing 6-arg call site
-- ambiguous ("function register_customer(...) is not unique") the moment
-- both existed. The old signature must be dropped explicitly first.
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
