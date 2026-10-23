# Merchant onboarding checklist

Reusable for every merchant. Nothing here needs a developer, SQL or a
platform admin — every step is done by the owner in their own console.
Tick each line, in order; the two test orders at the end prove the setup.

Who does it: **Owner** unless marked. Where: the owner console at
`/dashboard` (sign in at `/login`).

## BUSINESS

- [ ] **Register** at `/register`: business name, category (this sets the
      default modules — a food vendor, tuck shop or retail store gets
      Products + Orders; a salon gets Services + Bookings), owner name,
      email, password. The business starts as a draft: invisible to
      customers until it is published (last step).
- [ ] **Business information** (Console › Storefront › Business information):
      address, suburb, city, phone and WhatsApp as `+27 XX XXX XXXX`.
      The address pins the shop on the map — distance pricing and
      Skhokholetha need that pin.
- [ ] **Owner sign-in works** on the owner's own phone.
- [ ] **Staff** (Console › Staff — owner only): invite each person by email
      with a preset. The invite email carries the set-password link; if
      email is not configured the link is shown to the owner to share.
      | Preset | Gets | Does not get |
      |---|---|---|
      | Manager | orders, bookings, customers, catalogue, deliveries, analytics, pause orders | hours, fulfilment, zones, payments, domains, staff |
      | Counter / Cashier | orders, take payment, customers, bookings | analytics, settings, staff |
      | Kitchen | the kitchen screen: items, note, collection-vs-delivery; move to Preparing / Ready | customer phone or address, payment, management |
      | Driver | the driver screen: their assigned deliveries with address, phone, directions, picked-up / delivered | orders queue, customers, settings |

## STOREFRONT

- [ ] **Logo, banner and colours** (Console › Storefront › Design).
- [ ] **About / tagline** (Console › Storefront › Business information).
- [ ] **Contact** shown on the storefront: phone, WhatsApp (verified as
      `+27…`), address.
- [ ] **Opening hours** (Console › Settings › Opening hours): weekly
      hours; closed days; overnight hours allowed. The storefront shows
      OPEN / CLOSED from these and checkout refuses outside them.
- [ ] Know where **Pause orders** lives (Orders queue toolbar, also
      Settings › Opening hours): 30 min to 24 h, or "rest of today".
      Manager or owner.

## CATALOGUE

- [ ] **Categories** (Console › Catalogue › Manage categories): names and
      order; a hidden category hides its products from the storefront.
- [ ] **Products**: name, price (rands, stored as cents), category,
      photo, description; options / add-ons where needed.
- [ ] **Availability**: hide a product to take it off the storefront.
      (A separate "sold out today" flag is a later enhancement — hiding
      is the pilot's way.)

## FULFILMENT (Console › Settings › Collection & delivery)

- [ ] **Collection** on or off.
- [ ] **Delivery** on or off.
- [ ] **Who delivers**: Own drivers / Skhokholetha / Both. (Skhokholetha
      only works once the platform switches it on for the pilot.)

## DELIVERY (same page)

- [ ] **Pricing mode**: Flat fee, Distance, or Areas (zones).
- [ ] **Areas**: one row per area with ONE exact fee (no ranges). Optional
      minimum basket per area. Optional suburb list so a typed address
      pre-selects the area; otherwise the customer picks the area at
      checkout.
- [ ] **Service area**: an address outside every area is refused at
      checkout as "we don't deliver there yet". Disable an area to stop
      new orders for it; orders already placed keep their fee.
- [ ] **Preview**: the "What customers will see" box on the same page
      matches what you intend.

## PAYMENTS (Console › Settings › Payments)

- [ ] Decide **pay in person** (cash / card at the counter or to the
      driver) versus **pay online**. Pay in person needs nothing.
- [ ] Pay online: enter the merchant's own PayFast merchant ID, key and
      passphrase; run the R5 live verification. Until a LIVE connection is
      verified (and the platform allows live verification) the storefront
      honestly says "pay on collection" / "pay the driver".

## OPERATIONS

- [ ] **Who watches the queue**: at least one person signed in on the
      Orders page during trading hours. The page polls every 12 s, shows
      a sticky "new order" strip and can play a chime (unmute once per
      phone).
- [ ] **Who prepares**: kitchen staff signed in on the Kitchen screen.
- [ ] **Who dispatches**: a manager or the owner assigns own drivers or
      requests a Skhokholetha driver from the Deliveries page.
- [ ] **Notifications**: each person marks their own list read; one
      person clearing theirs does not clear a colleague's.
- [ ] **Customer messages** go by email to the address typed at checkout
      (confirmed, ready to collect, driver assigned, on its way,
      delivered, cancelled). No SMS or WhatsApp sending yet.

## PUBLISH

- [ ] **Publish** (Console › Storefront): needs at least one product or
      service. The storefront becomes live at `/store/<slug>` (and
      `<slug>.<storefront domain>` where configured).

## TEST ORDER (do both before telling customers)

- [ ] **Collection**: place an order from a phone → see it appear on the
      Orders page → Confirm → Kitchen marks Preparing then Ready → the
      customer email "ready to collect" arrives → take payment at the
      counter → Mark complete.
- [ ] **Delivery**: place an order choosing an area → the exact area fee
      shows before paying → Confirm → Ready → assign a driver (or request
      Skhokholetha) → driver marks Picked up → Delivered → the order shows
      Completed and the customer received "on its way" and "delivered".

## REAL-PILOT ACTIVATION (Skhokho Labs + the merchant, in this order)

The generic checklist above is what the merchant does. This is the order
in which the first real merchant is activated, with the Control Centre
readiness state as the final gate. No merchant-specific code, SQL or
configuration exists or is allowed.

| # | Step | Who | Done when |
|---|---|---|---|
| 1 | Create / register the business at `/register` (name, category, owner) | merchant, with MERCHANT SUPPORT on the phone | business visible in Control Centre › Businesses as *pending verification* |
| 2 | Owner account: sign in on the owner's own phone; password kept by the owner only | merchant | last sign-in shows on the business page |
| 3 | Contact information: address (pins the shop), suburb, phone and WhatsApp as `+27 …` | merchant | readiness › Business profile READY; "address pinned yes" |
| 4 | Storefront branding: logo, banner, colours, tagline / about | merchant | branding line on the business page shows logo and banner yes |
| 5 | Opening hours (and know where Pause orders is) | merchant | readiness › Opening hours READY |
| 6 | Categories and products with prices, photos, options | merchant | readiness › Products READY; counts on the business page |
| 7 | Staff invitations by preset (Manager, Counter, Kitchen, Driver) | merchant (owner) | Staff table shows each person *active* (not *invited*) |
| 8 | Fulfilment: collection on/off, delivery on/off | merchant | readiness › Fulfilment READY |
| 9 | Collection settings confirmed | merchant | readiness › Collection READY (or N/A if off) |
| 10 | Delivery settings: pricing mode | merchant | Delivery section on the business page shows the mode |
| 11 | Delivery zones with ONE exact fee each (and minimum basket if any); or the flat / distance fee | merchant | readiness › Delivery areas READY (zone mode) |
| 12 | Driver source: Own drivers for stage C (Skhokholetha only at stage E) | merchant | Delivery section shows "own drivers only" |
| 13 | Payment setup: pay in person for stage C (card payments off); PayFast only at stage D | merchant | readiness › Payments READY ("pay in person") |
| 14 | Publish the storefront | merchant | readiness › Storefront READY; public URL loads |
| 15 | **Readiness check** — the gate | MERCHANT SUPPORT | Businesses › merchant › Readiness shows **READY TO TRADE** and Trading now shows OPEN during hours; otherwise go back to the failing line |
| 16 | Collection test order from a phone (a R5 item, refunded in cash) | merchant + MERCHANT SUPPORT | order appears in Control Centre › Orders; completes; "ready to collect" email received |
| 17 | Delivery test order with the exact zone fee shown before confirming; own driver marks picked up and delivered | merchant + driver | order COMPLETED; delivery timestamps on the order; emails received |
| 18 | Payment test: cash recorded at the counter on the collection test (stage C); the R5 live verification only at stage D with FINANCE sign-off | merchant / FINANCE | order shows PAID with method; at D the connection shows VERIFIED |
| 19 | Support contact confirmation: the merchant has the support number and hours; Skhokho Labs has the owner's number and the shop's trading hours in the pilot log | MERCHANT SUPPORT | written in the pilot log |

Only after line 15 reads READY TO TRADE and lines 16–19 are ticked does
PLATFORM OWNER record "stage C live" in the pilot log.
