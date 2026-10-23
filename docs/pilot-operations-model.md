# Pilot operations model

Who does what while the first merchants trade. Designed for a team of two
to four people at Skhokho Labs; one person may hold several hats, but each
hat has one named owner and a backup.

## Named responsibility slots (fill in before launch — no names are invented here)

| Slot | Primary | Backup | Control Centre role |
|---|---|---|---|
| PLATFORM OWNER | ______ | ______ | SUPER_ADMIN |
| MERCHANT SUPPORT | ______ | ______ | OPERATIONS |
| PAYMENTS / FINANCE | ______ | ______ | FINANCE |
| DRIVER OPERATIONS | ______ | ______ | OPERATIONS |
| SECURITY | ______ | ______ | SUPER_ADMIN |
| TECHNICAL INCIDENTS (on-call engineer) | ______ | ______ | SUPER_ADMIN or OPERATIONS + Vercel/Neon/Resend access |

Rules for the slots: one person may hold two slots, never SECURITY and
TECHNICAL INCIDENTS alone (a compromised laptop would then hold everything);
every slot has a backup who can act within one working day; no slot is
24/7 — the uptime probe and alerts page during trading hours, otherwise
next morning.

### PLATFORM OWNER
- **Primary responsibility:** the go / no-go for every stage (A–E), the pilot log review, the legal register, naming the other slots.
- **Daily checks:** Overview once; the pilot log entry exists.
- **May change:** stage decisions; feature switches (with TECHNICAL executing the redeploy); admin roles.
- **Escalation:** receives every CRITICAL alert and every security incident.
- **Dual approval:** turning on `PAYMENTS_ALLOW_LIVE_VERIFICATION` (with FINANCE); turning on `BUDDY_EXTERNAL_AI` (with legal sign-off recorded); rotating `JWT_SECRET` or `PAYMENT_ENCRYPTION_KEY` (with TECHNICAL INCIDENTS).

### MERCHANT SUPPORT
- **Primary responsibility:** the merchant's line during their trading hours; onboarding help; readiness gaps; stuck orders (phone the shop); the support log (`docs/support-process.md`).
- **Daily checks:** Businesses › merchant › Readiness; Orders › needs attention (midday and close); merchant notifications.
- **May change:** nothing on a merchant's data — guidance only; may suspend a business for safety (reason required) and must tell PLATFORM OWNER immediately.
- **Escalation:** anything in TECHNICAL (R1–R6), any payment dispute (FINANCE), any delivery incident (DRIVER OPERATIONS), any suspected isolation issue (SECURITY, immediately).
- **Dual approval:** suspending a trading merchant outside an active incident (with PLATFORM OWNER).

### PAYMENTS / FINANCE
- **Primary responsibility:** payment failures and refund-due cases; the R5 live-verification sign-off; payouts; reconciliation questions; the merchant's own PayFast questions.
- **Daily checks:** Payments (failed, refund due, pending > 2 h); Payouts (available balances, requested payouts).
- **May change:** payouts (create, mark paid with a bank reference, mark failed with a reason); ledger adjustments (reason, reference, idempotency key, R5 000 cap). Never an amount, provider id or settlement state — no such command exists.
- **Escalation:** `payments_broken` or processing failures → TECHNICAL; suspected fraud or forged notifications → SECURITY.
- **Dual approval:** any ledger adjustment over R1 000 (with PLATFORM OWNER); enabling live verification (with PLATFORM OWNER); the first payout to any new driver.

### DRIVER OPERATIONS
- **Primary responsibility:** driver applications and documents; approvals, suspensions and reinstatements; dispatch problems; late deliveries; disputes; the on-call phone for stage E.
- **Daily checks:** Drivers › pending; Deliveries › searching and late; Overview › Skhokholetha figures.
- **May change:** document accept/reject; approve/reject/suspend/reinstate (reason required); cancel a delivery before pickup; open a dispute. `DRIVER_APPROVALS_ENABLED` on only while approving, off afterwards.
- **Escalation:** `dispatch_down` → TECHNICAL and PLATFORM OWNER; identity fraud suspicion → SECURITY; any injury, loss of goods or customer complaint about a driver → PLATFORM OWNER the same day.
- **Dual approval:** approving a driver whose documents were rejected before (with PLATFORM OWNER); reinstating a suspended driver.

### SECURITY
- **Primary responsibility:** admin authentication attacks; isolation reports; MFA resets; secret rotation; the Security and Audit logs; the uptime-probe and vault accounts.
- **Daily checks:** Security log counts (failed logins, MFA failures, permission denials, rate-limit trips); Audit log for privileged actions by anyone else.
- **May change:** admin MFA resets and role changes (reason required; never own); `JWT_SECRET` rotation during an incident; suspending any account.
- **Escalation:** POPIA s22 decisions → Information Officer and PLATFORM OWNER; anything criminal → PLATFORM OWNER.
- **Dual approval:** creating or promoting a super admin (break-glass script with a second person on the call); rotating `PAYMENT_ENCRYPTION_KEY`.

### TECHNICAL INCIDENTS (on-call engineer)
- **Primary responsibility:** `docs/runbooks.md` R1–R6, R9; deploys and rollbacks; cron; email and maps providers; the restore procedure; env changes (always with a `vercel env pull` to the vault).
- **Daily checks:** System health (DB, alerts, job runs, recent failures); Vercel deployment list; uptime-probe status.
- **May change:** deploys and instant rollbacks; feature switches when a slot owner has decided; manual cron runs; the test database.
- **Escalation:** anything touching money state → FINANCE; anything touching tenant data visibility → SECURITY; outage over 30 minutes → PLATFORM OWNER announces to merchants.
- **Dual approval:** any production database action outside `prisma migrate deploy` (with PLATFORM OWNER, in a screen-share); a restore/failover (with PLATFORM OWNER).

## Hats

| Hat | Owns | Where | Control Centre role |
|---|---|---|---|
| **Platform watch** (daily) | Overview at open, midday and close; System health once a day; Security log once a day; the daily pilot log | `docs/pilot-monitoring.md` | SUPPORT is enough to look; OPERATIONS to act |
| **Merchant support** | The merchant's WhatsApp/phone line; onboarding questions; "my order is stuck"; readiness gaps | Businesses › merchant › Readiness; Orders › needs attention; `docs/merchant-onboarding-checklist.md` | OPERATIONS (can suspend / reactivate) |
| **Payments** | Failed and refund-due payments; the R5 live verification sign-off; reconciliation questions; payouts | Payments; Payouts; `docs/runbooks.md` R3, R11 | FINANCE |
| **Delivery** | Dispatch problems, late deliveries, driver no-shows, disputes | Deliveries; Drivers; `docs/skhokholetha.md` | OPERATIONS (deliveries.intervene) |
| **Driver approvals** | Reviewing documents and approving drivers; suspensions | Drivers › pending | OPERATIONS (drivers.manage, drivers.documents) |
| **Security incidents** | Admin auth attacks, isolation reports, MFA resets, secret rotation | Security; Settings › Admin team; `docs/runbooks.md` R7, R8 | SUPER_ADMIN (one founder + one engineer) |
| **On-call engineering** | Database, deploys, cron, email provider, anything in R1–R6 | Vercel, Neon, Resend consoles | SUPER_ADMIN or OPERATIONS + Vercel access |

## Rhythm

- **Every trading day:** platform watch three times; merchant support reachable during the merchant's hours; one line in the pilot log.
- **Every day:** driver approvals queue cleared (while `DRIVER_APPROVALS_ENABLED` is on); payouts created for AVAILABLE balances over the agreed minimum; paid by FINANCE by EFT with the bank reference recorded.
- **Weekly:** 20-minute review of the pilot log, the P1 list and any `docs/alerts.md` HIGH that fired; decide on the next stage (`docs/pilot-readiness.md` stages A–E).
- **Before stage D (card payments):** FINANCE signs off the R5 live verification; a refund-due owner is named.
- **Before stage E (Skhokholetha):** delivery hat has an on-call phone; at least two approved drivers near the shop.

## Rules

- A platform admin never changes an order, payment amount, provider id or settlement state. Problems are surfaced (Orders › needs attention) and solved by phoning the shop.
- Every admin action needs a reason and lands in the audit log. "Login as merchant" does not exist and must not be built; read-only views plus explicit commands cover support.
- Pause levers before fixes: a switch or a suspension is always faster and safer than a hot fix during trading hours.
- One person on the team must be able to run `docs/backup-restore.md` end to end.
