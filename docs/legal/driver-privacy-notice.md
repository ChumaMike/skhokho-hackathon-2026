# Skhokholetha Driver Privacy Notice

**DRAFT FOR ATTORNEY REVIEW — not yet in force.**

**Version:** v0.1-draft-2026-10-21 · **Status:** DRAFT FOR ATTORNEY REVIEW · **Effective from:** not yet in force · **Law:** POPIA section 18 · **Applies to:** everyone who applies to drive, or drives, through Skhokholetha

> **[ATTORNEY: …]** marks a point counsel must decide. **[FILL IN: …]** marks a fact Skhokho Labs must supply. Acceptance is enforced by `DRIVER_PRIVACY_VERSION` and `DRIVER_PRIVACY_URL` exactly as for the Driver Terms. The general **Privacy Notice** (docs/legal/privacy-notice.md) applies to you too; this notice adds what is specific to driving.

---

## 1. Who is responsible

**Skhokho Laboratory ("Skhokho Labs")** is the responsible party for everything in this notice. Information Officer: [FILL IN: name, email, address].

## 2. What we collect and why

| What | Why | Basis |
|---|---|---|
| Name, mobile number, email address, password (hashed) | Your account and sign-in; contacting you about deliveries and payouts | Performing the Driver Terms |
| **ID document or passport** (the file), and for motorised vehicles your **driver's licence** and **vehicle registration** (the files); the document's expiry date | Confirming you may lawfully drive and deliver; the Driver Terms require it | Performing the Driver Terms; our legitimate interest in a safe network **[ATTORNEY: ID numbers and these documents — section 26 special-personal-information position; whether any element (e.g. a photo) is biometric]** |
| Vehicle type, registration number, make and model | Matching offers to your vehicle; identifying the vehicle at a shop | Performing the Driver Terms |
| **Bank details** (bank, account holder, branch code, account number) | Paying you. The account number is stored encrypted; only its last four digits are shown in the app | Performing the Driver Terms |
| **Your position** while you are online: a coarse position every few minutes, **latest only** (no history); during a delivery, your latest position is kept on that delivery and cleared when it ends | Offering you deliveries near you; showing the shop and the customer where their order is | **Your consent**, given in the app when you first go online; you can withdraw it by going offline — you then cannot receive offers |
| Which Driver Terms and Privacy Notice versions you accepted, when, a **hash** of your network address and your device's browser identifier | Proving acceptance | Legal obligation / legitimate interest |
| Offers sent to you and whether you accepted; delivery events you performed; pickup and drop-off code attempts (never the codes themselves) | Running dispatch; resolving disputes; detecting misuse | Performing the Driver Terms |
| Your earnings ledger, adjustments and payouts | Paying you; the financial record | Performing the Driver Terms; legal obligation to keep financial records |
| Review notes and suspension reasons written by platform staff | Deciding and explaining approval, suspension and reinstatement | Legitimate interest; the Driver Terms |

We do **not** collect your location when you are offline, track your route history, or record calls.

## 3. Who sees what

| Who | Sees |
|---|---|
| **The shop** whose order you are delivering | Your display name and vehicle type; your latest position from acceptance until the delivery ends; the delivery status |
| **The customer** of that order | Your display name; your position **only between pickup and arrival**; the delivery status on their own delivery page |
| **Platform operations reviewers** | Your application, documents (the file contents), vehicle details, acceptance records, ledger |
| **Platform finance administrators** | Your ledger, payouts, bank details (account number masked except when creating a payout) **[ENGINEERING: confirm who can decrypt]** |
| **Our operators** | Neon (database, United States), Vercel (hosting and logs), Resend (email), Google Maps (positions and addresses for matching and the tracking map) — see the Privacy Notice section 6 for the cross-border basis |

Your documents are stored in the database, never on a public file store, and are served only to platform reviewers; you can see the list of what you uploaded and its review status, not re-download the file.

## 4. How long we keep it

| What | Period | Note |
|---|---|---|
| Position | Latest only; cleared when the delivery ends and when you go offline **[ENGINEERING: confirm clear-on-offline]** | |
| **Documents (the files)** | **[FOUNDER + ATTORNEY DECISION]** Proposal: declined or withdrawn applications — deleted **90 days** after the decision; approved drivers — kept while approved and for **1 year** after deactivation, then the file bytes are deleted and only the kind, status, review date and expiry date are kept | Today documents are kept indefinitely; a purge job must be built before stage E |
| Bank details | Cleared **90 days** after your last payout once your account is closed | |
| Profile, vehicle | **5 years** after deactivation, then de-identified **[ATTORNEY]** | contractor and earnings record |
| Acceptance records | **5 years** after your last activity **[ATTORNEY]** | append-only |
| Ledger and payouts | **5 years** **[ATTORNEY: tax]** | cannot be deleted; de-identified instead |
| Offers, delivery events | 90 days / 2 years | dispatch and dispute record |

The full table is in docs/legal/retention-schedule.md.

## 5. Your rights

You may ask what we hold about you, ask for corrections, ask for deletion (subject to the records above that must be kept — we then de-identify), withdraw location consent at any time by going offline, object to processing based on our legitimate interests, and complain to the Information Regulator. Write to the Information Officer. The Data Subject Request Process explains verification and timelines.

## 6. Security

Documents and bank details are encrypted or access-controlled as described; passwords and tokens are hashed; platform administrators use multi-factor authentication; sensitive values are stripped from logs; important actions are audited. If a compromise affects your information we will notify you and the Regulator.

## 7. Contact and changes

Information Officer, Skhokho Laboratory ("Skhokho Labs"), [FILL IN: name, email, address]. A new version of this notice must be accepted in the app before you go online again.

---

### Change log

| Version | Date | Change |
|---|---|---|
| v0.1-draft-2026-10-21 | 2026-10-21 | First draft. Not reviewed by counsel. Document retention undecided. |
