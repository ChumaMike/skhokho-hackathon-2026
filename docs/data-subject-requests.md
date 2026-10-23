# Data-subject requests — the engineering side

What the platform can do today when a person (a customer, or a business
owner) asks for access to, or erasure of, their personal information. The
legal process (who may ask, how identity is confirmed, the response time,
the Information Officer) is Tab 2's `docs/legal-dependencies.md`; this
page records the mechanism it can rely on. Built 2026-10-21 (Tab 5).

## Where

Platform admin console › **Data-subject requests** (permission
`privacy.manage`: OPERATIONS and SUPER_ADMIN), and the **Data-subject
requests** section on a business's page. The customer-facing self-service
button waits for Customer accounts; until then every request is handled by
an admin.

## A customer

Keyed by the phone number the person gives us. The lookup lists every
business the person has a relationship with — by the pairwise customer
code and membership public id only; the global Skhokho customer id never
reaches the page or the export.

- **Export** (`/platform-admin/data-subjects/export`): one JSON file per
  business relationship — the membership, the identifiers we hold (phone,
  email), consents at that business and platform-scope consents, every
  visit (stamp / redeem), order (items, totals, delivery address, the
  notification email typed at checkout), appointment and review.
- **Erase** (reason required): `erase_membership()` — a SECURITY DEFINER
  RPC, the only write path into the identity core — revokes the membership
  and clears its display name, revokes consents at that business, and,
  when no other business still has a live relationship with the person,
  deletes their identifiers and de-identifies the customer row. The
  application then scrubs the order snapshots (delivery address,
  instructions, contact phone, coordinates, notes, notification email),
  appointment notes and review text for that membership. Visits are
  append-only by trigger and hold nothing personal; they remain as counts.

## A business

- **Export** (`/platform-admin/businesses/<id>/export`): profile, settings,
  hours, owner sign-in email, subscription, staff (no password hashes or
  tokens), roles, catalogue, customers (pairwise ids and stamp counts),
  orders, appointments, reviews, domains and registrations, payment
  connections (merchant id masked) and attempts, notifications, buddy
  conversations, content drafts.
- **Erase** (SUPER_ADMIN, `businesses.erase`, reason required): only once
  the business is SUSPENDED or DEACTIVATED — erasure is the last step of
  closing an account, never a way to close one. It removes and detaches
  domains, scrubs registrant details on registrations, erases every live
  customer relationship through the RPC, scrubs all order / appointment /
  review snapshots, de-identifies and deactivates every staff account and
  deletes their sessions, de-identifies the owner's sign-in when this was
  their only business and the account does nothing else, deletes
  notifications, buddy conversations and actions, content drafts and
  campaigns, storefront revisions, the onboarding profile and any pending
  email change, destroys the sealed PayFast credentials, and de-identifies
  the business row (status DEACTIVATED; id, name and slug kept so history
  still resolves). Each step is idempotent, so a failed run is re-run.

## What stays, and why

Payment attempts and events, domain registrations and network deliveries
are reconciliation / contractual history under `ON DELETE RESTRICT`. They
are kept with personal fields scrubbed, never deleted. The business row
and the memberships stay so that every one of those references still
resolves. Platform audit events keep hashed IPs only.

## The record

Every export and erasure writes a row to `data_subject_requests`
(append-only): kind, subject, the membership public id or a keyed hash of
the phone, who acted, the reason, and counts of what was touched. The
identity RPC also writes to the identity core's own `audit_log`, and the
admin action lands in `platform_audit_events`.

## Known limits

- Network delivery drop-off coordinates (`network_deliveries.dropoff_*`)
  are not nulled (non-nullable columns); the address text they were
  derived from is scrubbed.
- Driver documents and driver accounts are Tab 6's retention work, not
  covered here.
- Erasure de-identifies in place; it does not purge database backups
  (see `docs/backup-restore.md` for the retention window).
