# ECTA section 43 — information every storefront shows

**DRAFT FOR ATTORNEY REVIEW.**

**Version:** v0.1-draft-2026-10-21 · **Status:** DRAFT FOR ATTORNEY REVIEW · **Law:** Electronic Communications and Transactions Act 25 of 2002 (ECTA), section 43 (information to be provided by a supplier offering goods or services for sale by electronic transaction) and section 44 (cooling-off)

> This document is two things: (1) the **template block** every storefront renders in its footer, and (2) the **operating rule** for which fields come from where. **[ATTORNEY: …]** marks a point counsel must decide. The exact statutory list is not reproduced here from memory — counsel must check the rendered block against the Act.

---

## 1. Why the block exists

Every business that sells goods or services through its Skhokho storefront is a "supplier" making an offer by electronic transaction. ECTA s43 requires such a supplier to make a set of information available to the consumer on the website. The platform renders that information in a consistent block in every storefront footer, filled from the business's own profile and the **Legal** section of Dashboard › Settings, so a merchant cannot go live with it missing by accident.

**Skhokho Labs is not the supplier** of the goods or services; the block names the business. The platform's own identity appears separately in the "Powered by Skhokho" line and in the platform Terms and Privacy pages linked from the same footer. **[ATTORNEY: whether the platform must also publish its own s43 block for the platform service itself (for example for paid plans) and where.]**

## 2. The rendered block (what a customer sees)

```
About this business
{Legal name}, trading as {Business name}            ← "trading as" only when they differ
Registration number {Registration number}            ← only when supplied
{Street address}, {Suburb}, {City}, {Province} {Postal code}
Phone {Phone} · WhatsApp {WhatsApp} · Email {Email}  ← each only when supplied

Returns and cancellations
{Returns and cancellation text}

Complaints
{Complaints contact}                                  ← falls back to the business's phone / WhatsApp / email

Prices in South African rand. Orders and bookings are a contract with
{Legal name}. Platform: Skhokho Laboratory ("Skhokho Labs") · Terms · Privacy
```

Rendered in the storefront footer by `src/components/storefront/EctaInformation.tsx`; the field mapping and fallbacks are in `src/modules/tenant/legal-information.ts`.

## 3. Where each line comes from

| Line | Source | Required for "ready to trade" |
|---|---|---|
| Legal name | Dashboard › Settings › Legal → `settings.legal.legalName` | **Yes** |
| Trading name | Business name (`businesses.name`) | Always present |
| Registration number | Settings › Legal → `settings.legal.registrationNumber` (optional — sole proprietors have none) | No |
| Physical address | Business profile (`address`, `suburb`, `city`, `province`, `postalCode`) | Address line recommended; **[ATTORNEY: whether a physical address is mandatory under s43 for every supplier, including a home-based trader]** |
| Phone / WhatsApp / Email | Business profile | At least one contact (already required by readiness) |
| Returns and cancellation text | Settings › Legal → `settings.legal.returnsText` | **Yes** |
| Complaints contact | Settings › Legal → `settings.legal.complaintsContact`, falling back to WhatsApp, then phone, then email | **Yes** (a fallback counts) |
| Terms / Privacy links | Platform constants (`/terms`, `/privacy`) with their version strings | Always present |

Merchant readiness (`src/modules/platform-admin/merchant-readiness.ts`) shows **NEEDS ACTION — Legal information** while legal name, returns text or a complaints contact is missing.

## 4. Returns and cancellation text — guidance shown to the merchant

The Settings form shows this guidance next to the text box. **[ATTORNEY: approve or rewrite the guidance and the three starter texts; confirm the s44 cooling-off position and the s42(2) exclusions per category before any starter text is offered.]**

> Say plainly what happens if a customer wants to cancel or return. Customers have rights under the Consumer Protection Act and ECTA that you cannot take away; if you are not sure, say "We follow the Consumer Protection Act" and describe how to contact you.

Starter texts (merchant may edit):

- **Food and drink (perishable):** "Prepared food cannot be returned once made. If something is wrong with your order, tell us within [FILL IN] hours on the number below and we will replace it or refund you. You can cancel an order free of charge until we start preparing it."
- **Retail goods:** "Unused goods in their original packaging may be returned within 7 days of delivery or collection for a refund or exchange **[ATTORNEY: align with ECTA s44 and CPA s20]**. Faulty goods may be returned within six months **[ATTORNEY: CPA s56]**. Contact us first so we can arrange it."
- **Services and bookings:** "You can cancel or move a booking free of charge up to [FILL IN] hours before the time. Later cancellations or no-shows may be charged a reasonable fee of [FILL IN] **[ATTORNEY: CPA s17 reasonable cancellation charge]**."

## 5. Complaints route

The block must give the customer a route that works. Rule: the complaints contact is what the merchant typed; if blank, the storefront shows the business's WhatsApp number, then phone, then email. If the business has none of these, readiness already blocks it ("No phone or WhatsApp number").

The platform's own complaints route (for platform problems, or when the business does not respond) is the support contact in the Terms of Service, section 16.

## 6. Checklist before a storefront goes live (stage C)

- [ ] Legal name entered and matches the business's registration or the owner's full name for a sole proprietor
- [ ] Registration number entered where the business is a registered company or close corporation
- [ ] Street address, suburb, city, province entered
- [ ] At least one of phone / WhatsApp / email
- [ ] Returns and cancellation text entered and reviewed against the category guidance
- [ ] Complaints contact entered or a fallback present
- [ ] Footer block visible on the published storefront (home page and every sub-page)

---

### Change log

| Version | Date | Change |
|---|---|---|
| v0.1-draft-2026-10-21 | 2026-10-21 | First draft; block and field mapping implemented in code the same day. |
