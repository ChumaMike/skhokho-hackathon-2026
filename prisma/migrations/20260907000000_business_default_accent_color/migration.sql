-- Change the default primary brand color for new businesses from an
-- arbitrary Tailwind blue (#2563EB, never actually chosen by anyone) to
-- Skhokho's own amber (#E8A020, matches --amber in globals.css) — the
-- storefront's accent border/logo-fallback color visibly clashed with the
-- rest of the app's identity for every business that never customized it.
ALTER TABLE "public"."businesses"
  ALTER COLUMN "primary_color" SET DEFAULT '#E8A020';

-- Backfill existing businesses that still have the untouched old default —
-- #2563EB is not a value anyone would coincidentally hand-pick, so this
-- only touches rows nobody has actually customized. Deliberately does NOT
-- touch any row already storing a different value (a real merchant choice).
UPDATE "public"."businesses"
  SET "primary_color" = '#E8A020'
  WHERE "primary_color" = '#2563EB';
