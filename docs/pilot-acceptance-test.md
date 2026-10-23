# First-merchant acceptance test

A small, repeatable test run on real phones before the first merchant is
told "you are live", and again after any deploy during the pilot. Three
people: a **customer** (a Skhokho Labs person on their own phone, mobile
data, not on the shop's Wi-Fi), the **merchant** (owner or counter staff on
the shop's phone), and an **operator** in the Control Centre on a laptop.
Use a R5 item and an internal address; pay in cash; nothing real is sold.

Record **friction**, not only failures: anything that made a person
hesitate, scroll, retype or ask "where is…?" goes in the friction column.

## Customer (phone browser, portrait)

| # | Step | Pass when | Friction notes |
|---|---|---|---|
| C1 | Open the storefront link sent by WhatsApp | page loads in under 3 s on mobile data; shop name, OPEN/CLOSED badge, categories visible without zooming | |
| C2 | Open a product | photo, price as `R 12.50`, options if any; "Add to basket" reachable with a thumb | |
| C3 | Basket | quantities editable; subtotal correct; minimum order message if below it | |
| C4 | Checkout: name, phone, email | phone accepted as `082…` and shown as `+27 82 …`; keyboard is numeric for phone | |
| C5 | Fulfilment: Collection, then (second run) Delivery | collection shows the shop address; delivery asks for an address and area | |
| C6 | Exact delivery fee | the fee for the chosen area is shown **before** the Pay/Place button, matches the merchant's settings to the cent; an address outside every area is refused with "we don't deliver there yet" | |
| C7 | Payment method | "pay when you collect" / "pay the driver" wording for cash; card button only when the merchant is live on card | |
| C8 | Place the order | confirmation page with the order number; no double order on a double tap | |
| C9 | Status notification | emails: confirmed → ready to collect (collection) or driver assigned → on its way → delivered (delivery), each within a minute of the merchant's action | |
| C10 | Completion | tracking link (delivery) shows the final state; nothing further arrives | |

## Merchant (shop phone or tablet)

| # | Step | Pass when | Friction notes |
|---|---|---|---|
| M1 | New-order signal | the Orders page shows the sticky "new order" strip within 15 s; the chime plays if unmuted | |
| M2 | View the order | items, options, note, fulfilment, fee and customer phone readable without zoom | |
| M3 | Confirm | one tap; customer email "confirmed" arrives | |
| M4 | Prepare | Kitchen screen (if staffed) shows the order; Preparing is one tap | |
| M5 | Ready | Ready is one tap; collection email arrives | |
| M6 | Collection: take payment | "Paid in cash" recorded; order shows PAID | |
| M7 | Delivery: dispatch | assign an own driver from the Deliveries page; the driver's phone shows the job with address, phone and directions | |
| M8 | Driver: picked up → delivered | two taps on the driver screen; emails arrive | |
| M9 | Completion | order COMPLETED; it leaves the active queue | |
| M10 | Pause and resume | Pause orders for 30 min: the storefront says paused and refuses checkout; resume works | |

## Control Centre (operator)

| # | Step | Pass when |
|---|---|---|
| O1 | Businesses › merchant › Readiness | READY TO TRADE before the test starts; Trading now OPEN |
| O2 | Order visibility | both test orders appear under Orders within 15 s with the right business, fulfilment and status; "needs attention" stays empty while the merchant acts promptly; deliberately leave one order PENDING for 16 minutes and confirm it appears under "New, not actioned" |
| O3 | Payment trace | the cash order shows PAID / CASH on the order page; (stage D) the card order shows the attempt, one SETTLED notification, COMPLETE |
| O4 | Delivery trace | the own-driver delivery shows assigned / picked up / delivered timestamps on the order page |
| O5 | Alert visibility | Overview › Alerts shows nothing CRITICAL; after O2's deliberate delay the `orders_paid_unconfirmed` or new-order attention count appears and the "Open →" link lands on the right list |

## Result sheet

| Run | Date | Customer phone | Merchant device | Pass/Fail | Friction count | Notes |
|---|---|---|---|---|---|---|
| 1 | | | | | | |

A run passes when every "Pass when" holds. Friction items go to the P1
list in `docs/pilot-readiness.md` with the run number as evidence.
