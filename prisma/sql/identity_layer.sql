-- ============================================================
-- Customer identity layer — NEON PORT (staged)
-- Source of truth: supabase/migrations/20260714000001_customer_identity.sql
-- Spec: docs/superpowers/specs/2026-07-14-customer-platform-design.md
--
-- This is the Neon-adapted port. It is applied as a Prisma migration once Neon
-- is provisioned. Prisma manages the `businesses` table (created earlier); this
-- file owns the identity tables + functions + triggers + RLS + grants because
-- Prisma cannot express triggers/policies/SECURITY DEFINER functions.
--
-- ONLY TWO THINGS CHANGED from the Supabase original:
--   1. RLS predicate: businesses.auth_user_id = auth.uid()
--        →  business_id = current_setting('app.current_business_id')::uuid
--      (the Hono API sets this GUC per request via withBusinessContext();
--       there is no auth.uid() on Neon.)
--   2. Grants: service_role / anon / authenticated  →  app_runtime
--      (no PostgREST on Neon; all reads go through the Hono API as app_runtime,
--       the non-BYPASSRLS runtime role. There is no anon table access to revoke.)
--
-- ⚠ VERIFY AT PROVISION TIME: the `app_runtime` role must exist and be the role
--   in DATABASE_URL (owner bypasses RLS). Confirm Neon's role model when wiring.
-- ============================================================

-- Ordering note: uuid_generate_v7() / generate_short_code() are used as column
-- DEFAULTs, so they must exist before the tables below. This whole file is one
-- ordered migration, so that holds.

-- UUIDv7 (time-ordered) generator; Postgres < 18 has no built-in. Neon is PG15–17.
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  ts_millis BIGINT := FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000);
  rand_bytes BYTEA := substring(uuid_send(gen_random_uuid()) FROM 7 FOR 10);
  uuid_bytes BYTEA;
BEGIN
  uuid_bytes :=
    substring(int8send(ts_millis) FROM 3 FOR 6) || rand_bytes;
  uuid_bytes := set_byte(uuid_bytes, 6,
    (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
  uuid_bytes := set_byte(uuid_bytes, 8,
    (b'10' || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END $$;

-- Short code: 6 Crockford base32 chars + 1 check char, "XXX-XXXC"
CREATE OR REPLACE FUNCTION generate_short_code() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; -- Crockford
  body TEXT := '';
  total INT := 0;
  idx INT;
  i INT;
BEGIN
  FOR i IN 1..6 LOOP
    idx := 1 + floor(random() * 32)::int;
    body := body || substr(alphabet, idx, 1);
    total := total + (idx - 1);
  END LOOP;
  RETURN substr(body, 1, 3) || '-' || substr(body, 4, 3)
         || substr(alphabet, (total % 32) + 1, 1);
END $$;

-- ── Tables ───────────────────────────────────────────────────

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  display_name TEXT,
  language TEXT,
  merged_into UUID REFERENCES customers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE customer_identifiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('phone','email','wa_id')),
  value TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  source TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_identifier_verified
  ON customer_identifiers(type, value) WHERE verified_at IS NOT NULL;
CREATE INDEX idx_identifiers_value ON customer_identifiers(type, value);
CREATE INDEX idx_identifiers_customer ON customer_identifiers(customer_id);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  business_id UUID NOT NULL REFERENCES businesses(id),
  public_id UUID NOT NULL DEFAULT gen_random_uuid(), -- pairwise, random on purpose
  short_code TEXT NOT NULL,
  display_name TEXT,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  UNIQUE (customer_id, business_id),
  UNIQUE (business_id, short_code),
  UNIQUE (public_id)
);
CREATE INDEX idx_memberships_business ON memberships(business_id);

CREATE TABLE visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  membership_id UUID NOT NULL REFERENCES memberships(id),
  business_id UUID NOT NULL REFERENCES businesses(id),
  kind TEXT NOT NULL CHECK (kind IN ('visit','stamp','redeem')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_visits_membership ON visits(membership_id, kind);
CREATE INDEX idx_visits_business ON visits(business_id, created_at);

CREATE TABLE consents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  business_id UUID REFERENCES businesses(id), -- NULL = platform scope
  purpose TEXT NOT NULL CHECK (purpose IN ('loyalty_program','marketing','cross_business_link','order_updates')),
  channel TEXT CHECK (channel IN ('whatsapp','sms','email')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  source TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_consents_customer ON consents(customer_id, purpose);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('business_owner','platform','customer','system')),
  actor_id TEXT,
  business_id UUID,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_business ON audit_log(business_id, created_at);

-- ── Append-only enforcement (fires even for the table owner) ───

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

CREATE TRIGGER visits_append_only
  BEFORE UPDATE OR DELETE ON visits
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

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

CREATE TRIGGER consents_revoke_only
  BEFORE UPDATE OR DELETE ON consents
  FOR EACH ROW EXECUTE FUNCTION consents_revoke_only();

-- ── RLS: deny by default; owners read only their own memberships/visits ──
-- CHANGED FOR NEON: business identity comes from the SET LOCAL GUC the API sets
-- per request (withBusinessContext), not Supabase auth.uid().

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_read_memberships ON memberships FOR SELECT USING (
  business_id = nullif(current_setting('app.current_business_id', true), '')::uuid
);

CREATE POLICY owner_read_visits ON visits FOR SELECT USING (
  business_id = nullif(current_setting('app.current_business_id', true), '')::uuid
);
-- customers / customer_identifiers / consents / audit_log: NO policies.
-- Only the SECURITY DEFINER RPCs (run as owner) touch them.

-- ── Column visibility (CHANGED FOR NEON: grants target app_runtime) ──
-- memberships.customer_id is the global Skhokho ID and must never be readable
-- by the runtime role (pairwise-ID constraint) — grant only the safe columns.
REVOKE ALL ON customers, customer_identifiers, consents, audit_log FROM app_runtime;
REVOKE ALL ON memberships, visits FROM app_runtime;
GRANT SELECT (id, business_id, public_id, short_code, display_name, first_seen, last_seen, status)
  ON memberships TO app_runtime;
GRANT SELECT ON visits TO app_runtime;

-- ── Audit helper ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_write(
  p_actor_type TEXT, p_actor_id TEXT, p_business_id UUID,
  p_action TEXT, p_object_type TEXT, p_object_id TEXT, p_ip TEXT
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO audit_log (actor_type, actor_id, business_id, action, object_type, object_id, ip)
  VALUES (p_actor_type, p_actor_id, p_business_id, p_action, p_object_type, p_object_id, p_ip);
$$;

-- ── register_customer ────────────────────────────────────────
-- Find-or-create within ONE business. Unverified phones never link across
-- businesses: the lookup is scoped to memberships of this business.

CREATE OR REPLACE FUNCTION register_customer(
  p_business_id UUID, p_phone TEXT, p_display_name TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'owner_dashboard',
  p_actor_id TEXT DEFAULT NULL, p_ip TEXT DEFAULT NULL
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
    UPDATE memberships SET last_seen = NOW(),
      display_name = COALESCE(memberships.display_name, p_display_name)
    WHERE id = v_membership.id
    RETURNING * INTO v_membership;
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

-- ── log_visit ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION log_visit(
  p_business_id UUID, p_public_id UUID, p_kind TEXT DEFAULT 'stamp',
  p_actor_id TEXT DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_membership memberships%ROWTYPE;
  v_stamps INT; v_redeems INT;
BEGIN
  IF p_kind NOT IN ('visit','stamp') THEN
    RAISE EXCEPTION 'invalid_kind';
  END IF;

  SELECT * INTO v_membership FROM memberships
  WHERE public_id = p_public_id AND business_id = p_business_id
    AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'membership_not_found'; END IF;

  INSERT INTO visits (membership_id, business_id, kind)
  VALUES (v_membership.id, p_business_id, p_kind);
  UPDATE memberships SET last_seen = NOW() WHERE id = v_membership.id;

  SELECT count(*) FILTER (WHERE kind = 'stamp'),
         count(*) FILTER (WHERE kind = 'redeem')
  INTO v_stamps, v_redeems FROM visits WHERE membership_id = v_membership.id;

  PERFORM audit_write('business_owner', p_actor_id, p_business_id,
    'log_' || p_kind, 'membership', v_membership.id::text, NULL);

  RETURN jsonb_build_object('public_id', v_membership.public_id,
    'stamps', v_stamps, 'redeems', v_redeems);
END $$;

-- ── redeem_reward ────────────────────────────────────────────
-- required stamps read from businesses.config.loyalty_stamps_required (default 10)

CREATE OR REPLACE FUNCTION redeem_reward(
  p_business_id UUID, p_public_id UUID, p_actor_id TEXT DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_membership memberships%ROWTYPE;
  v_required INT; v_stamps INT; v_redeems INT;
BEGIN
  SELECT * INTO v_membership FROM memberships
  WHERE public_id = p_public_id AND business_id = p_business_id
    AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'membership_not_found'; END IF;

  SELECT COALESCE((config->>'loyalty_stamps_required')::int, 10)
  INTO v_required FROM businesses WHERE id = p_business_id;

  SELECT count(*) FILTER (WHERE kind = 'stamp'),
         count(*) FILTER (WHERE kind = 'redeem')
  INTO v_stamps, v_redeems FROM visits WHERE membership_id = v_membership.id;

  IF v_stamps - (v_redeems * v_required) < v_required THEN
    RAISE EXCEPTION 'not_enough_stamps';
  END IF;

  INSERT INTO visits (membership_id, business_id, kind)
  VALUES (v_membership.id, p_business_id, 'redeem');

  PERFORM audit_write('business_owner', p_actor_id, p_business_id,
    'redeem', 'membership', v_membership.id::text, NULL);

  RETURN jsonb_build_object('public_id', v_membership.public_id,
    'stamps', v_stamps, 'redeems', v_redeems + 1, 'required', v_required);
END $$;

-- ── lookup_membership (the enumeration-sensitive surface) ────

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
  WHERE m.business_id = p_business_id
    AND ci.type = 'phone' AND ci.value = p_phone
    AND m.status = 'active'
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*) FILTER (WHERE kind = 'stamp'),
         count(*) FILTER (WHERE kind = 'redeem')
  INTO v_stamps, v_redeems FROM visits WHERE membership_id = v_membership.id;

  RETURN jsonb_build_object(
    'public_id', v_membership.public_id,
    'short_code', v_membership.short_code,
    'display_name', v_membership.display_name,
    'stamps', v_stamps, 'redeems', v_redeems
  );
END $$;

-- ── Lock functions down (CHANGED FOR NEON: grant EXECUTE to app_runtime) ──
-- EXECUTE defaults to PUBLIC on new functions, so PUBLIC must be revoked.
REVOKE EXECUTE ON FUNCTION register_customer(UUID,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION register_customer(UUID,TEXT,TEXT,TEXT,TEXT,TEXT) TO app_runtime;

REVOKE EXECUTE ON FUNCTION log_visit(UUID,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION log_visit(UUID,UUID,TEXT,TEXT) TO app_runtime;

REVOKE EXECUTE ON FUNCTION redeem_reward(UUID,UUID,TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION redeem_reward(UUID,UUID,TEXT) TO app_runtime;

REVOKE EXECUTE ON FUNCTION lookup_membership(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lookup_membership(UUID,TEXT,TEXT,TEXT) TO app_runtime;

REVOKE EXECUTE ON FUNCTION audit_write(TEXT,TEXT,UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION audit_write(TEXT,TEXT,UUID,TEXT,TEXT,TEXT,TEXT) TO app_runtime;

REVOKE EXECUTE ON FUNCTION generate_short_code() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION generate_short_code() TO app_runtime;

REVOKE EXECUTE ON FUNCTION uuid_generate_v7() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION uuid_generate_v7() TO app_runtime;
