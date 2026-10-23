# Sending texts (SMS) — BulkSMS setup

What this covers: creating the BulkSMS account, getting the four values the app
needs, and what happens if you get one of them wrong. Nothing here is live yet —
the code is built and tested, but no text can be sent until these are set.

Decision of 2026-10-22: all three customer channels (SMS, WhatsApp, Web Push)
proceed in parallel after go-live. This is the SMS one. Paid-or-free is still
open, which is why there is a daily cap.

## Why BulkSMS

South African, prepaid, no contract, and a token pair you can create yourself in
a few minutes — chosen for speed of setup for the pilot, not because it is the
cheapest or the best. The adapter is deliberately thin
(`src/lib/messaging/providers/sms-bulksms.ts`, about 150 lines), so moving to
Clickatell or SMSPortal later means writing one more file like it and changing
one environment variable. Nothing else in the app knows which vendor sends.

## What you do, once

1. Create an account at bulksms.com. A normal business signup; no contract.
2. **Buy a small amount of credit first** — enough for a few hundred texts. Do
   not load a large balance until you have seen the first real sends land. The
   daily cap below limits the damage from a bug, but a small balance is the
   stronger protection.
3. In the portal, go to **Settings → API tokens** and create a token pair.
   - You get a **token ID** and a **token secret**.
   - This is NOT your portal username and password. Those would give the app
     full account access including buying credit; a token pair only sends.
   - The secret is shown once. If you lose it, delete the token and make another.
4. Optionally request an **alphanumeric sender id** (so texts come from
   "Skhokho" rather than a number). South African networks require registration
   for this and it can take a few days. Skip it to start — texts go out from the
   BulkSMS account default.
5. Make up a **webhook secret**: any long random string, e.g. from a password
   manager. It is not issued by BulkSMS; you invent it and we both use it.
6. In the portal, add a webhook (**Settings → Webhooks**):
   - URL: `https://<our domain>/api/messaging/bulksms/delivery?secret=<the secret from step 5>`
   - Trigger scope: **SENT** (this is what BulkSMS calls delivery reports)

## What to paste where

These go in Vercel's environment variables for the project, and in
`.env.local` for local work. Never commit them.

| Variable | Where it comes from | If you leave it out |
|---|---|---|
| `MESSAGE_PROVIDER` | Type `bulksms` | No texts at all; sign-in codes go by email only. Nothing breaks, and the gap is logged |
| `BULKSMS_TOKEN_ID` | Step 3 | Reads as unconfigured — no texts sent |
| `BULKSMS_TOKEN_SECRET` | Step 3 | As above |
| `BULKSMS_WEBHOOK_TOKEN` | Step 5 (the secret you invented) | Texts still send, but we never learn whether they arrived |
| `BULKSMS_SENDER` | Step 4, if you did it | Account default sender |
| `SMS_DAILY_CAP_PER_BUSINESS` | Leave unset for 500 | 500 per business per day |

Both halves of the token pair are required. With only one set, the app treats
the provider as **unconfigured** rather than trying and failing on every
message — so a half-finished setup costs nothing and is visible in the
environment report.

## The daily cap

500 texts per business per South African day (resetting at 00:00 SAST, not UTC
midnight), unless you set `SMS_DAILY_CAP_PER_BUSINESS`.

It **fails closed**: at the cap, further texts are refused, recorded with a
reason, and the shop's order updates fall back to email where there is an email
address. It is a spend guard against a loop or a bug, not a product limit — if a
real shop legitimately needs more, raise the number.

Customer sign-in codes are **not** attributed to a shop (the same phone is a
separate customer at every business, and sign-in must not pick one), so they
share one platform-wide bucket under the same number.

`SMS_DAILY_CAP_PER_BUSINESS=0` stops every text while leaving the provider
configured — useful if something is going wrong and you want it off now.

## What is recorded, and what is not

Every attempt is recorded in `message_logs`: which shop, what kind of message,
how many characters, whether the provider took it, the provider's message id,
and what it cost **in BulkSMS credits**.

Deliberately **not** recorded: the customer's phone number (only the last three
digits, as `+27 ** *** *123`) and the message text. The log proves what was sent
and what it cost without becoming a POPIA liability, and the message cannot be
reconstructed from it.

The cost is in credits, not rands. BulkSMS reports `creditCost` (e.g. 0.3 per
text) and its API does not say what a credit was bought for, so converting to
rands in the database would be inventing a number. To cost a month, multiply
credits by what you actually paid per credit.

## Honest limitations

- **The webhook is protected by a shared secret, not a signature.** BulkSMS
  publishes no HMAC or signing mechanism for webhooks, and warns that its source
  IPs change without notice, so an IP allowlist is not dependable either. A
  secret in the URL is the only control available. Consequently a delivery
  report is treated as information only: it updates the log and is wired to
  nothing that costs money or grants access. Rotate the secret by changing it in
  Vercel and in the BulkSMS webhook URL.
- **The cap can overshoot slightly.** It counts, then sends, so a burst of
  simultaneous messages can exceed the cap by the number already in flight. It
  is a budget, not an invariant.
- **Delivery reports are best-effort.** A text marked `ACCEPTED` reached the
  provider; `DELIVERED` means a report said it reached the handset. No report
  ever arrives for some numbers.
- **Nothing here has sent a real text yet.** The adapter is tested against a
  fake HTTP client covering acceptance, refusal, bad credentials, rate limiting,
  timeouts and malformed responses, and the request shape and response fields
  were checked against the published BulkSMS API spec. But the first real send
  is still the first real send: do it deliberately, to your own phone, with a
  small credit balance, and check `message_logs` afterwards.

## First live test, when you are ready

1. Set the variables, with `SMS_DAILY_CAP_PER_BUSINESS=5` for the test.
2. Sign in to a storefront account with your own phone number and ask for a code
   by SMS.
3. Check it arrives, then check `message_logs` has one `ACCEPTED` row with a
   `provider_message_id` and a `cost_credits`.
4. Wait a minute and check the same row has moved to `DELIVERED` — that proves
   the webhook and its secret are right.
5. Raise the cap to its real value.
