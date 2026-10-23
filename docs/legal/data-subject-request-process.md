# Data-subject request process (access, correction, deletion, objection)

**DRAFT FOR ATTORNEY REVIEW.**

**Version:** v0.1-draft-2026-10-21 · **Status:** DRAFT FOR ATTORNEY REVIEW · **Owner:** the Information Officer · **Law:** POPIA sections 23 (access), 24 (correction and deletion), 11(3) (objection), 69 (direct marketing opt-out); PAIA for the access procedure

> This is an **operating procedure** for Skhokho Laboratory ("Skhokho Labs"), not customer-facing text. The customer-facing summary is section 9 of the Privacy Notice. **[ATTORNEY: …]** marks a point counsel must decide. Today there is **no self-service export or erasure button**; every request is handled by a person following this procedure, with the technical steps listed in section 6.

---

## 1. Who may ask, and for what

| Requester | Can ask for |
|---|---|
| A customer (rewards card, order, booking, delivery) | what we hold about their mobile number; correction of name or language; deletion of their rewards card at one business or across the platform; objection to processing; marketing opt-out |
| A business owner or staff member | what we hold about their account; correction; deletion of their account (owner deletion ends the business — see 6.4) |
| A Skhokholetha driver | what we hold, including uploaded documents; correction; deletion after deactivation (document retention rules apply — see the Driver Privacy Notice) |
| A marketing-site enquirer | what we hold; deletion of the enquiry |

A request may come **directly** to the Information Officer, or **through a business** (a customer tells the shop). Businesses must pass requests on within [FILL IN: 2] business days (Merchant Terms section 7) and must not try to fulfil deletion themselves.

## 2. How a request is received

| Channel | Where it lands |
|---|---|
| Email to the Information Officer ([FILL IN: privacy email]) | Shared mailbox, label "DSR" |
| WhatsApp / phone to support | Support logs it to the DSR mailbox the same day |
| STOP reply to a marketing message | Handled immediately by the business's consent rules (Consent 3 in docs/legal/consent-wording.md); still logged as an opt-out |
| Via a business (console or email) | Business forwards to the DSR mailbox with the customer's card code, never the customer's full record |

Every request gets a **reference** `DSR-YYYYMMDD-nn` and a row in the DSR register (section 8) on the day it is received.

## 3. Verifying who is asking

We must not hand information to the wrong person. Verification is proportionate to what is asked:

| Request | Minimum verification |
|---|---|
| Marketing opt-out | None beyond the channel used (an opt-out is honoured even if unverified) |
| Access or correction for a customer | Proof of control of the **mobile number**: the Information Officer calls or WhatsApps the number on record and the requester confirms the reference. **[ATTORNEY: whether a callback to the number is sufficient, given public forms cannot prove ownership; OTP verification is a planned feature]** |
| Deletion for a customer | As above, plus a written confirmation from that number that they want their card(s) deleted |
| Owner / staff / driver account | Signed-in request from the account, or email from the account's address with a reply confirmation |
| Request by someone on behalf of another (parent, attorney) | Written authority and the data subject's ID **[ATTORNEY: PAIA form and ID requirements]** |

## 4. Timelines

| Step | Target |
|---|---|
| Acknowledge with the reference | 2 business days |
| Fulfil access / correction / deletion | within **[ATTORNEY: the PAIA period for access requests — 30 days, extendable once — and the reasonable period for s24 corrections]** |
| Marketing opt-out | immediately on receipt |
| Tell the requester what was done | same day as fulfilment |

No fee is charged. **[ATTORNEY: whether a PAIA access fee may or should be charged.]**

## 5. What each request type means on this platform

### 5.1 Access (POPIA s23)

Give the person a readable copy of: their identity record (display name, language, identifiers held), each membership (business name, card code, first and last seen, status), consents and withdrawals, orders and bookings with that membership (business, date, items, totals, fulfilment and delivery address), reviews, and — for drivers — their profile, vehicles, documents list, acceptances, ledger and payouts. Also the list of operators in the Privacy Notice section 6. Never include another person's data, security secrets, or internal identifiers that are not theirs.

### 5.2 Correction (s24)

Name, language, a wrong identifier, a wrong delivery address on a future order. Historical order records are not rewritten; a correction note is added where needed.

### 5.3 Deletion (s24) — and the **ON DELETE RESTRICT exception**

Deletion is **not a button**. The database deliberately refuses to delete rows that other records depend on:

- an **order with a payment attempt** (`business_payment_attempts.order_id` RESTRICT) must stay as the financial record of the sale;
- a **domain registration** (`domain_registrations`) must stay as the registrar record;
- a **driver profile** with ledger entries, payouts or legal acceptances (RESTRICT on all three) must stay as the earnings and acceptance record.

For those, deletion means **de-identification**: the person's name becomes blank, their identifiers (phone, email) are removed from the identity tables so they can no longer be matched, and the historical order keeps only what the financial record needs (amounts, items, date). **[ATTORNEY: confirm that de-identification satisfies s24 for records that must be retained, and the retention period that justifies keeping each (Tax Administration Act records, Companies Act, FICA where applicable).]**

Deletion of a **rewards card at one business** removes that membership, its visits and consents; the identity record stays if other memberships exist. Deletion **across the platform** removes every membership and the identity record itself, except where a RESTRICT record forces de-identification instead.

### 5.4 Objection (s11(3)) and withdrawal of consent

Objection to loyalty processing is treated as a request to leave the programme. Withdrawal of marketing consent is recorded as a revocation (`consents.revoked_at`), never by deleting the consent row, so the history of what was agreed and withdrawn stays provable.

## 6. Technical steps (performed by a platform administrator with the Information Officer's sign-off)

All steps run through the identity RPCs in `prisma/sql/` — never direct writes to identity tables — and are recorded in `platform_audit_events` with the DSR reference as the reason. **[ENGINEERING: the RPCs for 6.2–6.4 below do not all exist yet; the ones missing are listed in docs/legal-dependencies.md as "data-subject tooling".]**

### 6.1 Access export
1. Look up the identity record by identifier through the admin tooling (never by exposing `customers.id` to a business).
2. Run the export script `[ENGINEERING: scripts/maintenance/export-data-subject.ts — to be written]` which writes a JSON and a readable PDF of the items in 5.1.
3. Review for third-party data, then send through the verified channel.

### 6.2 Correction
1. Display name / language: identity RPC update.
2. Identifier: add the new identifier, mark the old one removed.

### 6.3 Deletion (customer)
1. List memberships, orders and payment attempts for the identity.
2. For each membership with **no** RESTRICT dependants: delete membership, visits, consents (revoke, then delete per retention rule), reviews.
3. For memberships with dependants: de-identify (6.5).
4. If no memberships remain: delete identifiers and the identity record; otherwise keep the identity record with no identifiers removed except those the person asked to remove.

### 6.4 Deletion (owner, staff, driver)
- **Staff:** deactivate, then blank name/phone/avatar and set a tombstone email after the retention period. Audit rows keep the staff id, not the name.
- **Owner:** an owner deletion ends the business (section 11 of the Merchant Terms). Business records follow the retention schedule.
- **Driver:** deactivate; documents handled per the Driver Privacy Notice retention; ledger and payouts stay (RESTRICT); profile de-identified after the retention period.

### 6.5 De-identification
Set display names blank, remove identifiers, clear delivery addresses and contact numbers on orders older than the operational period, keep amounts, items, dates and payment references. Record the DSR reference in the audit trail.

## 7. Telling the person

Reply through the verified channel with: what was found, what was changed or deleted, what was kept (and why, naming the retention rule), and their right to complain to the Information Regulator.

## 8. The DSR register

Kept by the Information Officer (spreadsheet or table): reference, date received, channel, requester type, request type, verification method, date acknowledged, date fulfilled, outcome, audit event ids. Kept for **[ATTORNEY: period]** years.

## 9. Escalation

If a request cannot be met within the period, the Information Officer writes to the requester before the deadline with the reason and the new date **[ATTORNEY: PAIA extension rules]**. Complaints go to the Information Regulator; we co-operate fully.

---

### Change log

| Version | Date | Change |
|---|---|---|
| v0.1-draft-2026-10-21 | 2026-10-21 | First draft of the procedure. Tooling for export and de-identification not yet built. |
