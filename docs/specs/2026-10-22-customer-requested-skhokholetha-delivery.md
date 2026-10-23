# Customer-requested Skhokholetha delivery — scope and design

**Date:** 2026-10-22 · **Status:** design only, nothing built (Tab 3, item 6) · **Owner for the build:** to be assigned after the legal dependencies below clear

Today a Skhokholetha driver is requested by the **shop**: a DELIVERY order comes in, the shop asks for a network driver from its queue, the quote parity rule prices it, and the customer only sees the result on their own delivery page (`docs/skhokholetha.md`). This document scopes the next step: the **customer** asks for Skhokholetha delivery directly, at checkout or after ordering, without the shop having to run its own driver or decide per order. It is a scope and pricing design with its legal dependencies named, so the build can be sized and sequenced. No code changes accompany it.

## 1. What a customer can order for delivery from the network

| Case | In scope for V1 of this feature | Why |
|---|---|---|
| A storefront order at a shop that has **delivery switched on** and allows **network drivers** (`fulfilment.deliverySources` NETWORK or BOTH) | **Yes.** The customer picks "Delivery by Skhokholetha" at checkout; the request to the network is raised automatically when the order becomes READY (or earlier, see §3). | This is the existing network flow with the trigger moved from the shop to the order lifecycle. Everything the network needs (pickup pin, drop-off pin, fee, codes) already exists on `OrderDelivery`. |
| A storefront order at a shop that has delivery **off** but is inside a Skhokholetha service area | **Yes, behind a per-shop opt-in** ("Let customers order delivery through Skhokholetha"). The shop still does collection only on its side; the driver collects like a customer would. | Most pilot shops will never run drivers. This is the case that makes the network useful to them. The shop must opt in because a driver at the counter changes how they work. |
| A shop with its **own drivers only** (`deliverySources` OWN) | No. | The shop has chosen to deliver itself. |
| Collection orders converted to delivery **after** ordering | **Yes, while the order is PENDING or CONFIRMED** and not yet picked up. | A customer who realises they cannot fetch it. Uses the same cancel-window logic as the customer account's self-service cancel (`customer-orders.service.ts`): once the shop has started, the change is a request the shop confirms. |
| Anything not an order on this platform (a parcel, a shop with no storefront) | No. | Skhokholetha is the logistics capability of the platform, not a courier product. |
| Bookings (services) | No. | Nothing to deliver. |
| Alcohol, medicine, anything age- or licence-restricted | No, excluded by category until the legal review in §5 says otherwise. | Driver and platform liability. |

Customer-facing name: **"Delivery by Skhokholetha"**. The shop's own delivery remains "Delivery".

## 2. The customer experience

1. **Checkout.** Under "How do you want it?" a third option appears where it applies: *Delivery by Skhokholetha — R xx, about N min*. The fee is quoted live from the existing pricing rule (§3) using the address or area the customer types, the same way the shop's own delivery fee is quoted today (`resolveStorefrontCartQuote`). Outside the service radius the option is not offered, with one line saying so.
2. **Payment.** Network deliveries stay **card-paid only** in V1, exactly as today ("only PAID orders can get a network driver"): a driver never carries cash. So the option is offered only when the shop's card payment is live (`checkoutPaymentOptions().card`). With "pay in person" chosen, the option disappears and the customer is told why in one sentence. This keeps item 4's payment choice intact.
3. **Confirmation page** (`/store/order/[orderId]`) shows "Delivery by Skhokholetha", the fee, the window, and the customer's own delivery page link — which already carries the drop-off code and live status.
4. **Status messages** (item 3) gain nothing new: driver assigned, on its way and delivered already go by email and phone.
5. **Account** (item 2): the order shows "Delivery by Skhokholetha" and the delivery page link; "Order again" offers the same delivery choice.
6. **Change after ordering** (§1 row 4): from the account, "Change to delivery" while the order is PENDING/CONFIRMED, re-quoted, paid by card for the fee difference (a second payment attempt on the same order, which `payment-attempt.service.ts` already supports).

The customer never sees the driver's surname, the shop's pickup code, or the network cost split. The shop sees exactly what it sees today for a network delivery.

## 3. Pricing

Skhokholetha's quote parity rule stays the one source of truth (`docs/merchant-operations.md`, `src/modules/skhokholetha/pricing.ts`): `networkCost = max(customerFee, R25 minimum)`, `merchantCost = networkCost − customerFee`. Two changes for the customer-requested case:

- **The customer fee is the network quote.** When the customer orders delivery by Skhokholetha, `customerFee = networkCost`, so `merchantCost = 0`. The shop pays nothing for a delivery it did not ask for. The quote uses the existing distance band and the R25 floor.
- **A shop may subsidise.** An optional merchant setting ("Cover up to R xx of Skhokholetha delivery for my customers") lowers the customer fee and raises `merchantCost` by the same amount, recorded on the delivery as today. Default: no subsidy. This reuses the parity fields `customerFeeCents` / `merchantCostCents`; nothing new is stored.
- **Service fee.** V1 keeps the platform fee at 0% as today. A customer-facing service fee is a pricing decision for the user (see Open items), not a code default.
- **Displayed as** `R 1 234.56` integer cents under the hood; the window as "about N–N+10 min" computed from the network ETA plus the shop's prep time (`settings.ordering.prepMinutes`, the same reader the confirmation page uses).

When is the network asked? **At READY** by default (the driver arrives to a ready order), with a shop setting to request at CONFIRMED for shops whose prep time is long and whose area has few drivers. Dispatch, offers, codes, tracking and payouts are unchanged.

## 4. What changes in the code (sizing only)

| Area | Change | Size |
|---|---|---|
| Quote (`storefront-cart.ts` / `delivery-quote.ts`) | A third fulfilment option `NETWORK_DELIVERY` priced by the Skhokholetha rule; eligibility = flags on + shop opted in + inside radius + card live | M |
| Order (`order.service.ts`, Tab 5 surface) | `fulfilmentMethod` gains `NETWORK_DELIVERY` **or** DELIVERY with `deliverySource: 'NETWORK'` on `OrderDelivery` (preferred: no enum change) | S |
| Checkout (Tab 3) | Option in `CheckoutView`, choice in `/api/store/checkout`, phone/email confirmation wording | S |
| Lifecycle | On READY (or CONFIRMED) a job calls `requestNetworkDelivery` with a request key derived from the order — idempotent, retried by the daily cron's dispatch tick | M |
| Account (Tab 3) | "Change to delivery" with re-quote and a second payment attempt | M |
| Shop settings (Tab 5) | "Let customers order delivery through Skhokholetha", subsidy amount, request-at-READY/CONFIRMED | S |
| Admin (Control Centre) | Nothing new: the delivery is a normal network delivery | — |
| Tests | Quote eligibility and pricing (pure), lifecycle request (DB), checkout HTTP | M |

Total: roughly two to three tab-days once the dependencies below are cleared. No migration is strictly required if `deliverySource` is recorded in the existing pricing snapshot; one small additive migration if it becomes a column (recommended for querying).

## 5. Legal and operational dependencies (blocking)

These come from `docs/legal-dependencies.md` and `docs/legal/consent-wording.md`; none is satisfied today.

| Dependency | Why it blocks this feature specifically | Stage it blocks |
|---|---|---|
| **Customer delivery notice** ("a Skhokholetha driver will see your name, phone number and address once assigned; your delivery page holds your code") | Today the shop raises the request, so the customer's data reaches a driver through the shop's relationship. When the **customer** asks, the platform is the responsible party for that disclosure and must say so at the point of choice. Shown at checkout under the option; version recorded on the order like the Terms tick. | E |
| **Terms of Service** covering the platform as delivery intermediary (who is liable for a lost or damaged order; refunds for a failed delivery; the fee) | The customer now pays the platform's network fee through the shop's PayFast account; the terms must say what that buys and what happens when it fails. The ECTA s43 information block on the storefront (Tab 2 / Tab 7) must name the delivery service and its fee basis. | C (terms) / E (delivery clauses) |
| **Driver terms and privacy notice** published and versioned (`DRIVER_TERMS_*`, `DRIVER_PRIVACY_*`) | Unchanged requirement; no network delivery runs without approved drivers. | E |
| **Refund path for a failed Skhokholetha delivery** | The shop's PayFast account took the money and the shop refunds in its own PayFast dashboard; with a platform-priced delivery the fee part needs a documented refund rule (shop refunds the whole order and the platform makes the shop whole? or the fee is a platform charge?). This is a FINANCE decision before any real delivery. | D/E |
| **Consent wording for order messages** by SMS/WhatsApp (POPIA s69 does not apply to transactional messages, but the wording must still be reviewed) | More messages per order (driver assigned, on its way, arrived). | E |
| **Restricted goods policy** | Which categories drivers may carry. | E |
| **Insurance / liability position for goods in transit** | Not recorded anywhere in the repo today. | E |

Until the first two rows exist, the feature must not be offered to a real customer. The engineering can be built dark behind `DELIVERY_REQUESTS_ENABLED` (existing) plus a new per-shop opt-in that defaults off.

## 6. Non-goals for this feature

Cash on delivery through the network; scheduled deliveries; deliveries across several shops in one trip; a customer picking a specific driver; tipping (a later, separate decision with its own payout rule); any change to the driver app.

## 7. Open items (for the user)

- Service fee or not, and who it is shown as coming from.
- Default trigger: READY vs CONFIRMED.
- Refund rule for a failed network delivery (FINANCE).
- Whether a shop subsidy is worth building in V1 or deferred.
