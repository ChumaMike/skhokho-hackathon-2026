-- Lock set_channel_consent down (notify-whatsapp follow-up).
-- 20261022142000 created the function SECURITY DEFINER and left EXECUTE at
-- its Postgres default, which is PUBLIC. That is wider than the posture in
-- prisma/sql/identity_layer.sql (revoke PUBLIC, grant the runtime role). The
-- 142000 file is frozen (production has its checksum), so the fix is this
-- separate migration. neondb_owner is the role both the app and migrations
-- connect as; app_runtime does not exist yet (deferred with RLS).
REVOKE EXECUTE ON FUNCTION public.set_channel_consent(text, text, text, boolean, text, jsonb, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_channel_consent(text, text, text, boolean, text, jsonb, uuid) TO neondb_owner;
