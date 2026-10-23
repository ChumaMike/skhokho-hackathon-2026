# Skhokho Platform — working notes

## What this is
The tenant-facing platform. Businesses register themselves and run their own
customers, loyalty and operations. **Not** the agency build factory — that lives
in `ChumaMike/skhokho-labs`.

## Hard rules
- Never expose the global Skhokho ID (`customers.id`) to a business. Businesses
  see the pairwise `memberships.public_id` / short code only.
- Cross-business linking stays behind its feature flag until s57 authorisation.
- Identity tables carry triggers, RLS and SECURITY DEFINER RPCs Prisma cannot
  express (`prisma/sql/`). Prisma models are for typed reads; **writes go through
  the RPCs**.
- Currency ZAR, displayed `R 1 234.56`, stored as integer cents.
- Phones `+27 XX XXX XXXX`. Mobile-first — most users are on Android.
- Plain, warm South African English in user-facing copy.
- No `@skhokho/*` workspace dependency. This app is self-contained.

## Not yet wired
`docs/port-source/` holds code imported for reference but deliberately not
activated. Read its README before touching anything in there.
