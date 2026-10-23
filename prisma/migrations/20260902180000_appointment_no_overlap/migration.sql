-- A real, DB-level guarantee that the same staff member can never have two
-- overlapping active appointments — closes the exact race in
-- createAppointment's staff-specific guard (a findFirst-then-create check,
-- which under concurrent requests can let two both pass the check before
-- either commits). Requires btree_gist for the equality (=) operator class
-- alongside the range overlap (&&) operator in one exclusion constraint.
--
-- Scoped to staff_id IS NOT NULL: no caller passes staffId today (see
-- appointment.service.ts's own comment — the storefront has no
-- staff-selection UI), so this constraint is currently inert in
-- production traffic, but is real protection the moment a
-- staff-assigning booking flow exists, not aspirational.
--
-- Does NOT cover the service-capacity case (Service.maxBookings > 1,
-- "at most N overlapping bookings for this service") — an exclusion
-- constraint can only express "no two rows may both match", not "no more
-- than N rows may both match". That case is handled by an advisory lock
-- in application code (see createAppointment), the same technique
-- redeem_reward uses for its own "at most one" check that isn't a
-- pairwise exclusion either.

CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- start_time/end_time are TIMESTAMP(3) — no time zone (see baseline
-- migration.sql) — so this uses tsrange, not tstzrange. tstzrange against
-- a non-tz column would implicitly cast through the session's timezone,
-- silently wrong for a stored naive timestamp rather than a real fix.
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_staff_no_overlap"
  EXCLUDE USING gist (
    "staff_id" WITH =,
    tsrange("start_time", "end_time", '[)') WITH &&
  )
  WHERE ("staff_id" IS NOT NULL AND "status" IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'));
