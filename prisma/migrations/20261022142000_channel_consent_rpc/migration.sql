-- set_channel_consent: the ONE writer for per-channel order-message consent
-- (purpose 'order_updates', channel whatsapp | sms | email) in the consents
-- ledger. No table DDL — consents already has purpose, channel, granted_at,
-- revoked_at, source and evidence, and the Prisma-created table carries no
-- CHECK on purpose (the list in prisma/sql/identity_layer.sql is the
-- documented intent; 'order_updates' is added there too).
--
-- Called from src/modules/customers/channel-consent.ts:
--   - granted = TRUE : one fresh row per matching membership (append-only
--     ledger: a customer who orders again consents again, as a new row).
--   - granted = FALSE: every open row for that membership/purpose/channel
--     gets revoked_at = NOW() (the consents_revoke_only trigger allows exactly
--     that), AND a standalone withdrawal row is inserted with
--     granted_at = revoked_at = NOW(), so a STOP is on record even when there
--     was nothing open to revoke. The latest row by granted_at decides.
--
-- p_business_id NULL means every shop the number is a member of — what a
-- STOP sent to the platform's single WhatsApp number has to mean, since the
-- customer cannot say which shop they meant. A grant at checkout passes the
-- shop. Returns {"memberships": n}; n = 0 when the number is unknown (no
-- customer is created here — a STOP from a stranger is not a registration).
--
-- Canonical copy also kept at prisma/sql/10_identity_rpcs.sql (the
-- human-readable source) — keep both in sync.
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
