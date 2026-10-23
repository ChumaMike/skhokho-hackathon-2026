# WhatsApp order messages — Meta WhatsApp Business Cloud API

**Status:** built, off. Nothing is sent until `MESSAGE_PROVIDER=whatsapp` and the four
`WHATSAPP_*` variables are set on a deployment, and that needs the steps below done first
(a verified Meta business, a dedicated number, approved templates). Turning it on in
production is Chuma's call, like any production environment change.

Owner of the number and the Meta business account: Skhokho Laboratory ("Skhokho Labs").
One number serves every shop; each message names the shop.

## How it works in the app

- The messaging seam (`src/lib/messaging/provider.ts`) already sends every order milestone and
  sign-in code to the phone typed at checkout. `MESSAGE_PROVIDER=whatsapp` selects
  `src/lib/messaging/providers/whatsapp-meta.ts` as the provider; nothing else in the app
  changes.
- WhatsApp only delivers **templates** when the business starts the conversation, so the
  provider turns each plain text it is handed into the matching approved template from
  `src/lib/messaging/whatsapp-templates.ts` (the catalogue below). A text it cannot match is
  refused locally (`whatsapp_template_unmatched`) and shows up in the logs and the SYSTEM audit
  trail like any failed message — it is never sent as free text for Meta to bounce.
- The webhook `POST /api/messaging/whatsapp/webhook` receives delivery statuses (`sent`,
  `delivered`, `read`, `played`, `failed`) and what customers write back. Every call is checked
  against the app secret's signature first. A `failed` status becomes a SYSTEM audit event with
  Meta's error codes. Pricing (`pricing.category`, `pricing.type`) is logged per status — Meta
  does not price a message in the send response.
- **STOP** from a customer withdraws WhatsApp order updates for every shop that number is a
  member of; **START** grants them again. Both are written to the consents ledger through the
  `set_channel_consent` RPC (purpose `order_updates`, channel `whatsapp`) and acknowledged with
  the wording in `docs/legal/consent-wording.md`. The provider checks that ledger at send time
  for every order message. A sign-in code the customer asks for is still sent after a STOP.
- Checkout records the number typed with the Terms accepted as that order's `order_updates`
  grant (evidence: order number and Terms version), so a later STOP has something to withdraw.

## Steps for Chuma (in order)

1. **Meta Business Portfolio.** At business.facebook.com create (or use) the portfolio for
   Skhokho Laboratory ("Skhokho Labs"). Everything below hangs off it.
2. **Business verification.** Business settings → Security centre → Start verification. Meta
   asks for the legal name, address and a document; use the registered company details and the
   documents Meta lists as accepted. Without verification the number is limited to 250 unique
   customers a day and the display name may not show.
3. **Meta app.** At developers.facebook.com create an app of type *Business*, add the
   *WhatsApp* product, and link it to the portfolio. Note the **App Secret** (App settings →
   Basic) — that is `WHATSAPP_APP_SECRET`.
4. **The number.** A dedicated number that has never been used on WhatsApp or WhatsApp
   Business, able to receive the one-time SMS or voice code. Add it under WhatsApp →
   API setup / WhatsApp Manager → Phone numbers. Display name: `Skhokho Labs` (Meta checks it
   against the verified business name). The number's **Phone number ID** (a numeric id shown
   next to it, not the number) is `WHATSAPP_PHONE_NUMBER_ID`.
5. **Payment method.** WhatsApp Manager → Payment settings: add a card. Meta charges per
   delivered template message by category; the rate for South Africa is on Meta's WhatsApp
   pricing page — check it there, it changes.
6. **Permanent token.** Business settings → Users → System users → add a system user
   (admin), assign the app and the WhatsApp account to it, then *Generate new token* with
   `whatsapp_business_messaging` and `whatsapp_business_management`, no expiry. That is
   `WHATSAPP_ACCESS_TOKEN`. Never use the temporary token from the API setup page in a
   deployment — it expires in 24 hours.
7. **Webhook.** Generate `WHATSAPP_VERIFY_TOKEN` (`openssl rand -hex 24`). Set all four
   variables on the deployment (preview first). Then in the app's WhatsApp → Configuration page
   enter the callback URL `<NEXT_PUBLIC_APP_URL>/api/messaging/whatsapp/webhook` and the verify
   token, click *Verify and save*, and subscribe to the **messages** field. Verification only
   succeeds once the deployment with the variables is live.
8. **Templates.** In WhatsApp Manager → Message templates, create each template below exactly
   as written (name, category, language English, body, footer, buttons, samples). Utility
   templates are usually approved within minutes; authentication templates are created from
   Meta's authentication flow (you choose the options, Meta writes the body).
9. **Test.** With `MESSAGE_PROVIDER=whatsapp` on a preview deployment and your own number as
   a customer, place a collection order and walk it through each status; send STOP and START
   to the number; check the SYSTEM audit trail shows no `message_failed` / `message_delivery_failed`.
10. **Production.** Set the variables on production and switch `MESSAGE_PROVIDER` — on your
    explicit go, with the attorney points below answered.

## Template catalogue (submit exactly as written)

Variables are `{{1}}`, `{{2}}` … in order; the *Variables* line says what goes in each; the
*Samples* line is what to type in the sample fields. Every utility template has the footer
**Reply STOP to stop WhatsApp order updates.** URL buttons use the platform's own origin
(`NEXT_PUBLIC_APP_URL`, e.g. `https://skhokho.sgdataint.co.za`) as the fixed part — never a
shop's domain.

### `skhokho_order_placed` — UTILITY, en

Body:

```
Thanks! Your order {{1}} at {{2}} is in: {{3}}, total {{4}}. Payment: {{5}}. Tap below to see your order.
```

- Footer: `Reply STOP to stop WhatsApp order updates.`
- Button (URL, dynamic): label `See my order`, URL `<NEXT_PUBLIC_APP_URL>/store/order/{{1}}`
- Variables: order number; shop name; "for collection" or "for delivery"; total, e.g. R 1 234.56; how to pay, e.g. "pay when you collect" or "paid online"
- Samples: `ORD-AB12-CD34`, `Kota Kings`, `for collection`, `R 125.00`, `pay when you collect`; button sample: an order id

### `skhokho_order_placed_delivery` — UTILITY, en

Body:

```
Thanks! Your order {{1}} at {{2}} is in: {{3}}, total {{4}}. Payment: {{5}}. Tap below to see your order and follow your delivery.
```

- Footer: `Reply STOP to stop WhatsApp order updates.`
- Button (URL, dynamic): label `Follow my delivery`, URL `<NEXT_PUBLIC_APP_URL>/delivery/{{1}}`
- Variables: order number; shop name; "for delivery"; total, e.g. R 1 234.56; how to pay, e.g. "pay the driver when it arrives" or "paid online"
- Samples: `ORD-AB12-CD34`, `Kota Kings`, `for delivery`, `R 145.00`, `paid online`; button sample: a delivery key

### `skhokho_order_confirmed` — UTILITY, en

Body:

```
Order {{1}}: {{2}} has confirmed your order and is getting it ready. Questions? Contact the shop on {{3}}.
```

- Footer: `Reply STOP to stop WhatsApp order updates.`
- Variables: order number; shop name; shop contact number, or "their Skhokho shop page"
- Samples: `ORD-AB12-CD34`, `Kota Kings`, `+27 82 123 4567`

### `skhokho_order_ready` — UTILITY, en

Body:

```
Order {{1}}: your order is ready. Come and fetch it at {{2}}. Questions? Contact the shop on {{3}}.
```

- Footer: `Reply STOP to stop WhatsApp order updates.`
- Variables and samples: as for `skhokho_order_confirmed`

### `skhokho_order_driver_assigned` — UTILITY, en

Body:

```
Order {{1}}: a driver is heading to {{2}} to collect your order. Questions? Contact the shop on {{3}}.
```

- Footer: `Reply STOP to stop WhatsApp order updates.`
- Variables and samples: as for `skhokho_order_confirmed`

### `skhokho_order_on_its_way` — UTILITY, en

Body:

```
Order {{1}}: your order from {{2}} is on its way to you. Questions? Contact the shop on {{3}}.
```

- Footer: `Reply STOP to stop WhatsApp order updates.`
- Variables and samples: as for `skhokho_order_confirmed`

### `skhokho_order_delivered` — UTILITY, en

Body:

```
Order {{1}}: your order from {{2}} has been delivered. Enjoy! Questions? Contact the shop on {{3}}.
```

- Footer: `Reply STOP to stop WhatsApp order updates.`
- Variables and samples: as for `skhokho_order_confirmed`

### `skhokho_order_cancelled` — UTILITY, en

Body:

```
Order {{1}}: {{2}} has cancelled this order. If you already paid, the shop will arrange your refund. Questions? Contact the shop on {{3}}.
```

- Footer: `Reply STOP to stop WhatsApp order updates.`
- Variables and samples: as for `skhokho_order_confirmed`

### `skhokho_login_code` — AUTHENTICATION, en

Created through Meta's authentication-template flow, not typed in. Choose: *Copy code* button
(label `Copy code`), *Add security recommendation* on, *Add expiry time* on, 10 minutes. Meta's
resulting body is:

```
{{1}} is your verification code. For your security, do not share this code.
```

- Footer (Meta's): `This code expires in 10 minutes.`
- Variables: the 6-digit sign-in code (also the copy-code button's value)
- Samples: `123456`

## Replies to STOP and START (free text, inside the 24-hour window)

After STOP:

> You said STOP. Done — you won't get WhatsApp order updates from Skhokho shops again. Your orders and rewards are still safe. Reply START if you change your mind.

After START:

> Welcome back. You'll get WhatsApp updates about your orders from Skhokho shops again. Reply STOP any time to stop — free, and we stop right away.

Recognised as STOP (whole message, any case, trailing punctuation ignored): stop, stop all,
unsubscribe, cancel, end, quit, opt out. As START: start, unstop, resume, subscribe. Anything
else a customer writes is counted in the logs and not answered — the number is not a support
line; the shop's contact is in every message.

## What the logs and audit trail show

| Where | Event | Meaning |
|---|---|---|
| log `message.failed` / audit `message_failed`, detail `whatsapp_<code>` | Meta refused the send | `131047` outside the 24-hour window (a free text where a template was due); `132001` template missing or not approved; `132000` wrong number of variables; `131026` number cannot receive WhatsApp; `130429` throughput limit; `190` token expired; full list on Meta's error-codes page |
| detail `whatsapp_template_unmatched` | the plain text did not match the catalogue | wording in `src/lib/messaging/templates.ts` changed without the catalogue — the unit test should have caught it |
| detail `whatsapp_opted_out` | the customer said STOP | expected, not a fault |
| log `whatsapp.delivery` | a status webhook | `status`, Meta's message id, pricing category and type |
| audit `message_delivery_failed` | status `failed` | Meta's `errors[].code` in metadata |
| audit `messaging_webhook_rejected` (SECURITY, DENIED) | a webhook call failed the signature or the verify token | investigate: misconfigured secret, or someone probing the URL |

## Consent and POPIA — points for the attorney

- Order updates are messages about an order the customer placed; the app treats them as
  service messages, not direct marketing, and the Consent 3 (marketing) opt-in does not gate
  them. [ATTORNEY: confirm the lawful basis — performance of the contract or legitimate
  interest rather than consent — and whether the Terms tick plus the typed WhatsApp number is
  sufficient evidence, given the tick is required to order.]
- [ATTORNEY: confirm that sending a sign-in code the customer requested is proper after a STOP,
  or whether STOP must also block codes (then the customer signs in by email).]
- [ATTORNEY: confirm the STOP footer on every message and the free STOP reply meet whatever
  opt-out notice duty applies to these service messages.]
- [FILL IN: Skhokho Labs' WhatsApp number, once issued, in the Privacy Notice's "how we
  contact you" section, and the Information Officer's details in Meta's business profile.]
- Meta is the processor for every message body and number. [ATTORNEY: confirm the Meta /
  WhatsApp Business terms cover the cross-border transfer (POPIA s72) and whether the Privacy
  Notice must name Meta as an operator.]

## Still to build

- Showing a shop its order messages' delivery status in the dashboard.
- Per-shop WhatsApp numbers (today: one platform number, shop named in the text).
- Message templates in isiZulu, isiXhosa and Afrikaans — professional translation first, as
  for the consent wording.
- Cost reporting per shop from the status webhook's pricing fields.
