# Layered Consent Wording — DRAFT

> ⚠️ **DRAFT for attorney review + professional translation.** English copy below is production-ready
> in tone but must be legally signed off. The isiZulu / isiXhosa / Afrikaans versions must be done by a
> **professional legal translator** — do not machine-translate binding consent copy. Each consent is
> **separate** (never one bundled checkbox), plain-language, and recorded as an immutable artefact
> (timestamp, wording `version`, channel, evidence). Opt-out ≠ consent (POPIA, Apr-2025 Regulations).

**Wording version:** `v1.0-draft` · **Channels:** WhatsApp (reply-to-confirm), in-app toggle, QR page.

---

## Consent 1 — Join this business's rewards (per-business)

> **{{ Business name }} rewards card** 🎁
> Want a rewards card here? We'll save your visits so you can earn free stuff.
> We keep your number to run your card. That's it.
> Reply **YES** to start your card. Reply **STOP** any time to leave — free, no questions.

- POPIA basis: the per-business loyalty relationship. **Does not** trigger s57.
- Granting this alone gives the customer the full per-business benefit.

## Consent 2 — Link across Skhokho businesses (the s57 cross-business layer) 🔒

> **One rewards profile, all your shops** ✨
> Want to see your rewards from all Skhokho shops in one place?
> If you say yes, we link your rewards across the shops you choose to join — so you never lose a stamp.
> Your shops **never see each other's info**, and you can unlink any time.
> Reply **LINK** to turn this on. You still keep all your rewards if you say no.

- **This is the consent gated by the POPIA s57 application.** Capture it now; the actual linking stays
  **off** behind the feature flag until the Information Regulator authorises it.
- Must be genuinely optional — declining still gives full per-business rewards (voluntariness).

## Consent 3 — Marketing (per channel, POPIA s69)

> **Offers & specials** 📣
> Want deals and specials from {{ Business name }}?
> Choose how we reach you: reply **WA** for WhatsApp, **SMS** for SMS, **EMAIL** for email.
> Reply **STOP** any time — free, and we stop right away.

- One channel per opt-in; each recorded separately. Existing-customer carve-out is **per-business**;
  cross-business marketing needs its own opt-in.
- Every send checks the consent table at send time and is cleansed against the NCC opt-out registry
  (≥ monthly) before dispatch.

### Order updates by WhatsApp (service messages — not marketing)

> **WhatsApp / phone number** — at checkout, the number the customer types is where that order's
> updates go: confirmation, ready to collect, driver assigned, on its way, delivered, cancelled, and
> a sign-in code when they ask for one. Each message names the shop and ends with
> *"Reply STOP to stop WhatsApp order updates."*

- These are messages about an order the customer placed, sent from Skhokho Laboratory ("Skhokho
  Labs")'s one WhatsApp number on behalf of the shop. They are **not** marketing and are **not**
  gated by this Consent 3 opt-in; nothing promotional may ride on them.
- Recorded per order as `purpose = order_updates, channel = whatsapp` in the consents ledger
  (source `storefront_checkout`, evidence: order number + Terms version) through
  `set_channel_consent`. A **STOP** reply withdraws it for every shop that number is a member of
  (one platform number → the customer cannot name a shop); **START** grants it again. Sign-in codes
  the customer asks for are still sent after a STOP.
- Template texts, exactly as submitted to Meta: `docs/notifications-whatsapp.md`.
- [ATTORNEY: confirm the lawful basis for order-update messages — performance of the contract /
  legitimate interest under POPIA s11(1)(b)/(f) rather than consent — and whether the Terms tick
  plus the typed number is sufficient evidence, given the tick is required to order. Confirm that
  WhatsApp delivery of a sign-in code at the customer's own request may continue after a STOP.]
- [ATTORNEY: confirm no ECTA s45 / CPA s11 direct-marketing obligation attaches to these
  service messages, and that the STOP footer satisfies any opt-out notice duty that does.]

---

## STOP / withdrawal (must always work, free)

> You said **STOP**. Done — you won't get messages from {{ Business name }} again.
> Your rewards card is still safe. Reply **START** if you change your mind.

- `STOP` revokes the relevant marketing consent(s) immediately (append `revoked_at`; never delete).
- Withdrawing Consent 2 unlinks the global ID from that customer.
- Objections accepted via WhatsApp, free of charge (Apr-2025 Regulations).

## Recorded per consent event
`{ customer_id, business_id, purpose, channel, granted_at | revoked_at, source, wording_version, evidence }`

## Translations (professional translator required)
- [ ] isiZulu — Consents 1–3 + STOP
- [ ] isiXhosa — Consents 1–3 + STOP
- [ ] Afrikaans — Consents 1–3 + STOP (if in target regions)

*Do not deploy any translation that hasn't been professionally produced and attorney-reviewed.*
