-- Apply BEFORE `prisma db push` — these functions are used as column DEFAULTs
-- (customers.id, memberships.id, …), so they must exist before the tables.
-- Extracted from prisma/sql/identity_layer.sql. Neon = PG15–17.

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

CREATE OR REPLACE FUNCTION generate_short_code() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
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
