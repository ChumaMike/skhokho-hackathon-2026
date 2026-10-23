# POPIA s57 Prior-Authorisation Application — DRAFT

> ⚠️ **THIS IS A DRAFT FOR YOUR POPIA ATTORNEY. NOT LEGAL ADVICE, NOT A FILING.**
> It is a structured first draft assembled from `docs/research/2026-07-14-popia-legal-shared-customer-id.md`
> so your attorney can review, correct, and finalise before submission to the Information Regulator.
> **Do NOT submit as-is.** Fields marked `{{ … }}` need your input. The cross-business linking layer
> must stay **suspended** (POPIA s58(2)) and behind its off-by-default feature flag until the Regulator
> decides. File via the Regulator's prescribed form: https://inforegulator.org.za/prior-authorisation/

---

## 0. Why this filing exists (the trigger)

POPIA **s57(1)(a)** requires prior authorisation before processing a **unique identifier** of data
subjects (i) for a purpose other than the one it was collected for, **and** (ii) with the aim of
**linking the information with information processed by other responsible parties**. Skhokho's
cross-business customer graph — one platform-held identity linked to the same person's records at
multiple independent businesses — is squarely that case. Processing without authorisation is a criminal
offence and carries administrative-fine exposure up to **R10 million**. This application covers **only**
the cross-business linking layer; per-business loyalty/CRM does not trigger s57 and is not part of it.

---

## 1. Applicant (responsible party)

| Field | Value |
|---|---|
| Registered name | {{ Skhokho Labs legal entity name + registration no. }} |
| Trading name | Skhokho Labs |
| Physical / postal address | {{ … }} |
| Information Officer | {{ name }} — registered with the Regulator on {{ date }} ({{ registration ref }}) |
| Deputy Information Officer(s) | {{ if any }} |
| Contact | {{ email / phone }} |

**Role:** Skhokho Labs is the **responsible party** for the cross-business identity layer (it determines
the purpose and means of the linking). For each participating business's private per-business records,
Skhokho acts as an **operator** under s20–21 written contracts. This application concerns the layer
where Skhokho is the responsible party (or joint responsible party with the businesses).

---

## 2. The processing subject to prior authorisation

**What is processed:** a platform-held customer identity ("global customer record") to which a person's
separate memberships at multiple participating businesses are linked, enabling a consolidated,
customer-facing view ("your rewards across all your shops") and platform-internal analytics.

**The unique identifiers involved:**
- The internal global customer ID (`customers.id`, a random UUID) — **never disclosed to any business**.
- The customer's **phone number** (verified identifier, E.164), used as the linking/lookup key.

**The linking across responsible parties:** when the same **OTP-verified** phone number is enrolled at
Business A and Business B, the platform links both memberships to one global customer record. Each
business only ever sees a **different, opaque pairwise identifier** (`membership.public_id` + a human
short code), never the global ID and never the other business's relationship — so **no business can
correlate a customer with any other business**. The linkage exists only inside the platform and in the
customer's own consolidated view.

---

## 3. Purpose(s) of the processing

1. Give the **customer** a single, consented view of their memberships and rewards across participating
   businesses ("my shops, my rewards").
2. Enable **platform-internal, aggregated analytics** to improve the service.
3. (Future, separately consented) reach consented customers with relevant offers — governed by POPIA
   s69 direct-marketing rules and the NCC opt-out registry; **not** enabled at launch.

The cross-business link is **never a condition** of the per-business benefit: a customer who declines it
still receives the full loyalty/CRM benefit at each business (preserving consent voluntariness).

---

## 4. Categories of personal information

- Identity: display name, language preference.
- Contact / identifier: mobile phone number (verified), optionally email / WhatsApp ID.
- Relationship/behavioural: per-business membership records, visit/stamp/redeem ledger entries.
- Consent records: purpose, channel, timestamp, wording version, evidence.
- **Not collected:** SA ID numbers; no biometric, health, financial-account, or special personal
  information for this layer (data minimisation).

## 5. Categories of data subjects

Adult customers of participating South African small businesses (initial segment: salons, barbers,
taverns, takeaways) who have **opted in** to the cross-business layer.

## 6. Recipients / other responsible parties

The participating businesses (each a responsible party for its own records; joint with Skhokho for the
shared layer, under a signed data-sharing / joint-responsible-party agreement). No onward disclosure to
third-party advertisers occurs without a separate, explicit `third_party` opt-in and is out of scope of
this application.

---

## 7. Safeguards (why authorisation should be granted)

The architecture is designed to be *approvable* — minimisation + tokenisation + layered consent:

- **Pairwise, tokenised identifiers (OIDC-style):** businesses receive only per-business opaque IDs;
  the global ID never leaves the platform tier. Businesses cannot join their customer lists.
- **Deterministic, verified linking only:** links form only on **OTP-verified** phone numbers; ambiguous
  matches go to a manual candidate queue — **never auto-merged** — preventing cross-contamination of
  strangers' histories from a typo. Merges are soft (`merged_into` tombstone), reversible, and logged.
- **Layered, per-purpose, per-channel consent** (see §8), append-only with evidence; opt-out ≠ consent;
  withdrawal unlinks the global ID.
- **Deny-by-default access control:** Postgres row-level security; businesses have no row access to the
  global `customers` table — only their own memberships plus a permitted-field projection.
- **Append-only audit log** of every identifier read, lookup, export, merge, and consent change.
- **Data residency:** hosted in **af-south-1**; no raw PII sent to foreign AI APIs (pseudonymised first).
- **Minimisation:** no SA ID numbers; phone masked everywhere a business didn't collect it itself.
- **Security programme** sized to being a breach target: encryption at rest/in transit, documented s19
  risk assessment / PIA, incident-response runbook wired to the Regulator's eServices breach portal.

## 8. Consent architecture (layered — never bundled)

Three separate, plain-language, mobile-first (WhatsApp reply-to-confirm) toggles, recorded as immutable
consent artefacts (timestamp, wording version, channel, evidence):
1. **Join this business's loyalty programme** (per-business; POPIA basis for the per-business layer).
2. **Link my profile across Skhokho businesses** (the s57 cross-business layer — this application).
3. **Receive marketing** (per channel: WhatsApp / SMS / email — separate, s69-governed).

Draft wording lives in `docs/legal/consent-wording.md` (to be produced) in English + isiZulu/isiXhosa.

## 9. Retention & data-subject rights

- Retention: membership data anonymised/deleted {{ N }} months after a business churns; dormant-identifier
  handling per the identity spec. Purpose limitation enforced.
- Rights console: access/export, correction, per-purpose deletion, consent withdrawal (unlinks the global
  ID), objection via WhatsApp free of charge (per Apr-2025 Regulations).

## 10. Statutory suspension (s58(2))

Skhokho acknowledges it **may not carry out the cross-business linking processing until the Regulator
responds** (4 weeks; up to ~13 further weeks if investigated). Until then the linking layer remains
disabled behind an off-by-default feature flag. Per-business processing continues lawfully in the interim.

---

## 11. Attachments to prepare (checklist for the attorney)

- [ ] Personal Information Impact Assessment (PIA)
- [ ] Data-sharing / joint-responsible-party agreement template (merchant onboarding)
- [ ] s20–21 operator agreement (per-business private records)
- [ ] Layered consent wording (EN + isiZulu/isiXhosa), with versioning
- [ ] Information Officer registration confirmation(s)
- [ ] s19 security-measures description / risk assessment
- [ ] Data-flow / architecture diagram (pairwise IDs, tokenised linking)

---

*Assembled by Claude Code from the project's legal research. Your POPIA attorney must review and finalise
every section before any submission. The cross-business layer stays dark until the Regulator decides.*
