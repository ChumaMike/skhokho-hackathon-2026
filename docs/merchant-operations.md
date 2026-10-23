# Merchant operations — configuration model

Everything a merchant needs to run a shop day to day is configuration on the
business, enforced server-side in one place each. Nothing here knows what
kind of shop it is; no area, suburb or merchant name lives in code.

```
Business
  operatingHours            weekly hours (operating-hours.ts; editor: Settings › Opening hours)
  settings.ordering
      minOrderCents         minimum basket (subtotal)
      pausedUntil           "Pause orders now" — ≤ 24 h, independent of hours
  settings.fulfilment
      collectionEnabled     customers may choose Collection
      deliverySources       OWN | NETWORK | BOTH   (who may deliver)
  settings.delivery
      enabled               customers may choose Delivery
      pricingMode           FLAT | PER_KM ("Distance") | ZONE
      FLAT:   feeCents
      PER_KM: baseFeeCents + perKmFeeCents × road km, floored at minFeeCents,
              refused beyond maxDistanceKm (0 = no limit)
      ZONE:   delivery_zones (table) — one exact fee per merchant-defined area
```

## One source each

| Rule | Decided in | Enforced for |
|---|---|---|
| Open / closed / paused | `src/modules/tenant/trading-status.ts` | quote + checkout (`HOURS_CLOSED`, `ORDERS_PAUSED`), storefront badge, checkout page, dashboard |
| Collection / delivery allowed | `getFulfilmentSettings` | quote + checkout (`COLLECTION_UNAVAILABLE`, `DELIVERY_UNAVAILABLE`) |
| Who delivers | `allowsOwnDrivers` / `allowsNetworkDrivers` | `assignDriver` (in-house) and `checkOrderEligibility` (Skhokholetha) |
| Delivery fee | `src/modules/delivery/delivery-quote.ts` | the customer quote (`storefront-cart.ts`) and the Skhokholetha cost basis |
| Service area | same quote: `OUTSIDE_SERVICE_AREA` (no matching zone / beyond max km) | checkout cannot proceed as delivery |
| Order completion | `completeOrder` — READY only (conditional update) | every caller |

## Delivery zones

`delivery_zones`: `businessId`, `name` (unique per business), `matchKind`
(`CUSTOMER_PICK` or `SUBURB_LIST`), `suburbs[]` (lower-cased), `feeCents`,
`minOrderCents?`, `active`, `priority`. The customer picks an area at checkout
(the only honest default where geocoding is unreliable); with `SUBURB_LIST`
the typed address pre-selects the area by whole-word suburb match. The server
validates the chosen zone belongs to this business and is active; the fee is
the zone's cents, never a client value. Ranges such as "R15–R20" are not
representable — a merchant converts them to one exact fee per area (or to
distance bands via a second zone).

The order snapshot (`order_deliveries.delivery_fee_cents`, `delivery_zone_id`,
`delivery_zone_name`) freezes what was charged; renaming or disabling a zone
later never rewrites history.

## Skhokholetha quote parity

The network cost for a delivery is based on the exact fee the customer paid:

```
networkCost   = max(customerFeeCents, NETWORK minimum R25)
merchantCost  = networkCost − customerFeeCents      (shown to the shop before confirming)
driverEarning = networkCost − platformFee (0% in V1)
```

Recorded on `network_deliveries` (`customer_fee_cents`, `merchant_cost_cents`)
and in the frozen snapshot. The shop must echo the network cost back when
requesting (`confirmedFeeCents`), so a shortfall is never silently absorbed.
Both sides use the same road-distance rule (`src/modules/delivery/distance.ts`).

## Live operations

`GET /api/dashboard/pulse` (staff with canManageOrders or canPrepareOrders):
pending/active counts, newest order id/time, this person's unread
notifications. `LiveOrdersPulse` polls it every 12 s while the tab is
visible, shows a sticky strip, refreshes the server-rendered page on change,
and plays an opt-in chime (muted by default, per browser).

Notifications: `business_notifications` plus per-person read markers in
`business_notification_reads` — one teammate reading never hides a
notification from another. Merchant notifications now also cover
`payment_received`, `order_cancelled`, `delivery_assigned`, `delivery_failed`.

Customer messages (email, to the address typed at checkout and stored only on
the order as `metadata.notifyEmail`): confirmed, ready for collection, driver
assigned, out for delivery, delivered, cancelled. Always sent after the
transaction, never inside it; a failed send cannot touch order state and is
recorded as a SYSTEM event with safe metadata only. No code or token is ever
in an email.

## Permissions

| Action | Permission |
|---|---|
| Weekly hours, fulfilment, pricing, zones | `canManageSettings` |
| Pause / resume orders | `canManageOrders` (an operational action) |
| Categories | `canManageServices` (catalogue) |
| Order detail: phone / address | `canManageOrders` or `canManageDeliveries`; Kitchen sees items, note and collection vs delivery only |

## Backward compatibility

A business that never saved the new keys behaves exactly as before: collection
on, both driver sources allowed, FLAT/PER_KM pricing unchanged (legacy
`PER_KM` with no base/min/max keeps working), no zones, hours fail-open. No
data migration; all new columns are nullable or defaulted.
