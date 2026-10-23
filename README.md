# Skhokho

**FNB App of the Year Hackathon 2026 — team Skhokho.**
Challenge: Youth entrepreneurship and small-business growth.

Skhokho gives a South African small business a place to register itself and
run its own shop: a storefront customers can order from, orders and a kitchen
screen, bookings, a customer list with loyalty stamps, staff with roles, and
payments that settle straight into the business's own account. Built in Dube,
Soweto, and live with real township businesses.

- Live platform: https://skhokho.sgdataint.co.za
- Judges' demo: Owner login at /login as owner@skhokho-demo-kitchen.local on the hackathon preview deployment (URL and password are in the submission deck on Sonke, not in this repository). The demo business is Skhokho Demo Kitchen (/store/skhokho-demo-kitchen) on the GROW plan, with three months of order history.

## Built during the hackathon (23–26 October 2026)

Built on 23 October 2026: the Cash-flow Forecast and Funding-Readiness Report. From the business's own order history it forecasts the next four weeks of daily sales (/dashboard/analytics/forecast), produces a print-ready one-page funding-readiness statement a lender can read (/dashboard/analytics/forecast/funding), and lists customers who are slipping, overdue or gone quiet against their own ordering rhythm, with a WhatsApp link where the customer left a number (/dashboard/analytics/forecast/win-back).

Everything else in this repository existed before the hackathon. This snapshot
was exported from the private sg-os monorepo at commit `6f02c87a`
(2026-10-23); the hackathon commits are the ones dated 23–26 October 2026.
Daily progress is logged on the team page on Sonke.

## How it is built

Next.js 15 (App Router) · React 19 · TypeScript · Prisma 6 on Neon Postgres
(row-level security and SECURITY DEFINER RPCs for the customer-identity
tables, see `prisma/sql/`) · PayFast · Vercel · Node test runner.

A customer has one Skhokho identity but every business only ever sees its own
pairwise membership code — no business can see that a customer shops
elsewhere (POPIA s57). Money is ZAR, stored in cents, shown as `R 1 234.56`.

## Run it

```
cp .env.example .env.local      # fill in a Postgres URL and a JWT secret
pnpm install
pnpm db:deploy                  # applies prisma/migrations
pnpm db:seed                    # a demo business to look at
pnpm dev                        # http://localhost:3002
pnpm test
```

The original platform README, with ownership and environment details, is in
`docs/PLATFORM-README.md`.
