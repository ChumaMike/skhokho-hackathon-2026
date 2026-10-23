# Cash-flow Forecast and Funding-Readiness Report — built feature

**Date:** 2026-10-23 · **Status:** built on `feature/cashflow-forecast`, reads only, no migration · **Branch owner:** forecast tab · **Why now:** the FNB hackathon entry (decisions log, 2026-10-23 14:30 and 14:40), demoed from a Vercel preview on a seeded demo database

A merchant on Skhokho already has the one thing a small South African business almost never has written down: a clean record of what it sold, day by day. This feature turns that into the two things such a business is repeatedly asked for and cannot produce — **what next month looks like**, and **a page a lender will accept**. Everything is computed from the business's own paid orders. Nothing is stored, no table was added, and no plan changed.

Three pages, all under Analytics:

| Route | What it is | Plan |
|---|---|---|
| `/dashboard/analytics/forecast` | Next four weeks, day by day, with the week-by-week chart, the slow days, the Business Buddy's explanation and the method | `basic_analytics` (FREE and up) |
| `/dashboard/analytics/forecast/funding` | The printable funding-readiness one-pager | `advanced_analytics` (GROW, PRO) |
| `/dashboard/analytics/forecast/win-back` | Customers predicted to lapse, with a message to send | `advanced_analytics` + customer permission |

There is no new nav section: the Analytics overview carries a link card, and the forecast page links to the other two. The section list lives in `src/lib/workspace-nav.ts` and a sub-page of Analytics does not belong in it.

## 1. What counts as takings

One definition, used by every figure in the feature: **`payment_status = 'PAID'`, and order `status NOT IN ('CANCELLED', 'REFUNDED')`**.

- An unpaid or pending order is not revenue. A paid order that was later cancelled or refunded is money handed back, so it is not money to plan next month's stock around, and a funding figure that counted refunds as revenue would be the wrong kind of wrong.
- **This differs on purpose from the Analytics overview** (`analytics.service.ts`), which counts every `PAID` order whatever its order status. So for the same weeks, this feature's history can read slightly *under* the overview's totals. The forecast page's method card says so in one line, because the first person to compare the two pages will otherwise think one of them is broken.
- `orders.total` is `Decimal(10,2)` in **rands**, not integer cents — CLAUDE.md's "integer cents" rule does not hold for this table. The conversion to cents happens in SQL (`total * 100`), where it is exact; every module above that works in integer cents and emits `R 1 234.56` alongside each figure.
- Days are grouped by **calendar day in UTC**, matching `analytics.service.ts`'s weekly bucketing.

## 2. The forecast method

`src/modules/analytics/forecast.ts` — pure, no Prisma, tested against fixtures.

1. **History window.** The last **84 days** (12 weeks) of daily paid takings. Older history says little about next Tuesday and makes the averages slow to notice a real change.
2. **Zero-filling.** Days with no takings *between* the first and last day with data count as zero. A quiet Monday is information about Mondays; dropping the gap would average only the good days and overstate every forecast. Days **before** the first order are not invented, so a shop that opened last week is not charged with empty weeks it never traded.
3. **Day-of-week average.** For each weekday: everything paid on that weekday ÷ how many of those days the window covers.
4. **Trend.** Least-squares slope through the **complete** 7-day blocks, counted back from the last day with data (a part-week at the old end is dropped rather than compared as if whole). Fewer than two complete weeks ⇒ slope 0; there is no trend to measure and the answer is flat, not a guess.
5. **Forecast day** = weekday average × week factor, where `factor(k) = 1 + (k × slope) ÷ expected week`, `k` = 1..4 and `expected week` = the sum of the seven weekday averages.
6. **The cap.** The factor is held inside **±50%**. A straight line through a few weekly totals, carried four weeks out, can predict double or nothing; nobody should order stock against either. When the cap bites, the page says so.
7. **Slow days.** A weekday whose average is under **60%** of the average weekday (comparing only weekdays that have actually come round). A weekday with no history yet is never called slow and never drags the bar down.
8. **Confidence.** `none` (no history at all) · `thin` (under two complete weeks) · `fair` (two or three) · `good` (four or more).

Worked example, six level weeks at R 400 a day: every weekday average is R 400, the expected week is R 2 800, the slope is R 0.00, so each of the four forecast weeks is R 2 800 and the four-week total is R 11 200.00, at confidence `good`.

The forecast starts **the day after today** — today's takings are still coming in, but they do count towards the averages.

## 3. The Business Buddy's explanation

`forecast-advice.ts` builds the sentences; the page renders them and `ruleBasedProvider` (`llm-provider.ts`) answers forecast questions with the same text. One source, so the page and the chat can never tell an owner two different things about the same numbers. No model is involved and the page says so.

The buddy's forecast case sits **first** in the rules chain: the existing briefing case matches a bare `next`, so a case appended at the end would never be reached by "what does next week look like?". Its pattern is narrow (`next week`, not `next`) and three tests pin that the briefing and orders cases still win their own questions. The forecast also goes into the model system prompt as figures the model must quote rather than rework.

## 4. The funding-readiness report

`funding-readiness.ts` (pure) + `.service.ts`. Light-on-white, one A4 side, print rules in the CSS, no PDF library — the browser's own print-to-PDF makes the better document, which is the call the printable invoice already made.

| Figure | Definition |
|---|---|
| Months trading | Whole months from the **first paid order**; falls back to registration only if the shop has never been paid. "under a month" is said in words, not as 0. |
| Revenue | Lifetime paid takings. |
| Paid orders | Lifetime count. |
| Average order | Revenue ÷ paid orders. |
| Repeat customers | Of the customers who have **paid for an order**, the share who have paid for **two or more**. Counted by **orders per membership**, never by `first_seen`. |
| Revenue, month by month | Up to 12 months. The month still running is shown flagged "so far" and never compared — a calendar is not a decline. Month on month compares the last two **whole** months. |
| Consistency | See below. |

**Consistency score** = `100 − (average swing ÷ average week) × 100`, over complete weeks, clamped to 0–100, and withheld entirely under **four** complete weeks (two weeks can only say "these two differed by X", which is not consistency). The average swing is the mean **absolute** distance from the average week, not a standard deviation: "your weeks are usually R 300 either side of R 2 400" is a sentence an owner and a lender can both check by hand, and squaring the differences would let one unusual week dominate a number meant to describe the ordinary ones. Bands: ≥75 strong · ≥50 fair · else uneven.

Worked example: weeks of R 1 000, R 3 000, R 1 000, R 3 000 ⇒ average week R 2 000, average swing R 1 000, score `100 − (1000 ÷ 2000) × 100 = 50`, band fair. The page prints that line with the real numbers in it.

The footer states what the report is **not**: unaudited, Skhokho orders only (cash taken outside Skhokho is not in it), not a credit score, not a rating, not a recommendation to lend.

## 5. The win-back prediction

`win-back.ts` (pure) + `.service.ts`. Each customer is measured against **their own** median gap between paid orders, not one business-wide rule. The existing `getLapsed`'s flat 30 days would flag every monthly customer who is perfectly fine and miss every daily customer who has really gone.

Thresholds are `slipping = max(7 days, gap × 1.2)`, then `overdue` and `gone` keep their distance from that line (`× 2 ÷ 1.2` and `× 4 ÷ 1.2`), with `gone` also capped at 90 days:

| Their usual gap | Slipping from | Overdue from | Gone from |
|---|---|---|---|
| 2 days | 7 days | ~12 days | ~23 days |
| 7 days | ~8 days | 14 days | 28 days |
| 30 days | 36 days | 60 days | 90 days |

The one-week floor lifts the **whole** scale, not just the first band. As a bare minimum it made the middle bands unreachable for frequent customers — someone ordering every second day went from fine on day six to gone on day eight, which is not a thing to say about a person who might have been away for a week.

A customer who has ordered only **once** is measured against the shop's own median gap, or 30 days until the shop has a pattern of its own. Nobody is listed inside 7 days.

Order is deliberate: **winnable before already-gone, biggest spender first within each**. An owner with ten minutes should spend them on the people most likely to come back and worth the most when they do. The list is capped at 20 and says how many were held back.

## 6. Privacy boundary

- A customer appears as **`memberships.public_id`**, their **first name** and their **short code**. Never `customers.id`, never the membership row id, never the full name the shop holds. A DB test serialises the whole list and asserts all three are absent, reading the real `customers` ids out of the table to check against.
- The only phone number a business may see is one the customer typed into a **delivery order themselves** (`order_deliveries.contact_phone`) — the one place the app already shows a business a number, behind `canManageOrders` / `canManageDeliveries` on the Orders page. The win-back service does not even read a number without that permission.
- A WhatsApp link is offered only for a valid SA mobile (`isValidZaMobile`). A link to a landline is a dead end dressed up as an action; the page says why there is no link instead.
- The pre-filled message names the **business**, never Skhokho.
- No customer data goes to any model: the explanation is rules-based, and the forecast handed to the buddy is business figures only.

## 7. Plan gating and permissions

`forecast-access.ts` answers it once for all three pages and the buddy. **Existing keys only — no feature key added, no plan changed, nothing moved between plans.**

| | FREE (`basic_analytics`) | GROW / PRO (`+ advanced_analytics`) |
|---|---|---|
| Forecast, chart, day-by-day table, method, buddy explanation | yes | yes |
| Summary of what the longer history adds | yes | — |
| Funding-readiness report | no | yes |
| Win-back list | no | yes (with customer permission) |

Three distinct permission answers, not one: `canViewAnalytics` for the forecast · `canManageCustomers` **or** `canIssueLoyalty` before any customer appears · `canManageOrders` **or** `canManageDeliveries` before a contact number does. So a role with analytics but no customer permission gets the funding report (which holds no customer details) and not the win-back list. It is a policy, not a gate: the pages still call `requireStaffPermission`, every service read is scoped to one business, and hiding a link has never been what keeps anyone out.

## 8. Files and tests

| File | What |
|---|---|
| `src/modules/analytics/forecast.ts` | The forecast arithmetic (pure) |
| `src/modules/analytics/forecast.fixtures.ts` | Sales histories for the tests, including the demo business's weekend-peak shape |
| `src/modules/analytics/forecast.service.ts` | The only DB read for the forecast |
| `src/modules/analytics/forecast-advice.ts` | The buddy's sentences (pure) |
| `src/modules/analytics/forecast-access.ts` | Plan and permission policy (pure) |
| `src/modules/analytics/funding-readiness.ts` / `.service.ts` | The report |
| `src/modules/analytics/win-back.ts` / `.service.ts` | The win-back list |
| `src/app/dashboard/analytics/forecast/**` | The three pages and their CSS modules |
| `src/modules/assistant/llm-provider.ts`, `assistant.service.ts` | The rules-first forecast case and the context it reads |

Tests: **97 pure** (28 `forecast`, 12 `forecast-advice`, 21 `funding-readiness`, 20 `win-back`, 11 `forecast-access`, and 5 cases appended to `buddy.test.ts`) and **25 against a real database** (9 + 8 + 8 in the three `*.service.db.test.ts` files). The DB tests cover what counts as takings, UTC day grouping, the window, one business never seeing another's orders or customers, the repeat rate read off customers who were all first seen today, and the privacy assertions above.

## 9. Non-goals

- **No stored forecast.** Nothing is written; every figure is computed on request. `BusinessMetric` stays unpopulated, as `analytics.service.ts` already notes.
- **No charting dependency.** Hand-rolled CSS bars, like the Analytics overview. Eight weekly figures do not need a library.
- **No credit decision.** The consistency score describes steadiness. The report says, in words, that it is not a score, a rating or a recommendation to lend.
- **No seasonality, no public holidays, no weather.** A day-of-week average with a capped linear trend is what 12 weeks of data can honestly support. Month-of-year effects and the payday cycle are visible in the data but not modelled — see open items.
- **No outbound messages.** The win-back list hands the owner a WhatsApp link to tap. Nothing is sent by the platform, so none of the notification channels' consent rules are touched.

## 10. Open items

1. **Payday cycle.** Township trade lifts around month-end. A day-of-month factor would improve the forecast materially but needs more than 12 weeks of history to fit honestly. Worth revisiting once a pilot shop has six months on the platform.
2. **Cash outside Skhokho.** The report's biggest honest weakness: a shop taking cash off-platform looks smaller than it is. The footer says so. A "cash I took outside Skhokho" declared figure would help a lender but is unverifiable, so it was left out deliberately — a product decision if it is ever wanted.
3. **Lender-facing wording.** The consistency bands and the footer were written here, not by anyone who lends money. Worth one read by somebody who has sat on the other side of the desk before this is put in front of a real funder.
4. **Order of the forecast and the overview.** Two pages now report revenue on slightly different definitions (§1). If that proves confusing in the pilot, the right fix is to change the *overview* to exclude refunds, not to loosen this feature.
