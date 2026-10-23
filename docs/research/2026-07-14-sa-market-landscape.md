# South African Market Landscape: Shared Customer-ID Platform for Informal Businesses (2026)

Research conducted July 2026 via web search.

---

## Executive summary

The "digitise the township business" space is crowded on the **payments and supply side** (Kazang, Flash, Shop2Shop, Yoco, iKhokha, A2Pay) and littered with corpses on the **B2B e-commerce side** (MarketForce, and pivots at Wasoko/MaxAB, TradeDepot). It is almost **empty on the customer-relationship side** — nobody has built the "who are my customers" layer for spazas, salons and taverns. That's the gap, but it's empty partly for hard reasons: informal merchants pay for things that visibly bring in cash *today*, and a customer database is a delayed, abstract benefit. The realistic wedge is **WhatsApp-first loyalty + customer capture by phone number**, sold as "bring your regulars back", with the website as a bonus, not the hook. Cashback/airtime-style instant rewards beat points for this market. POPIA and the NCA put real constraints on the marketing and credit-scoring upside.

---

## 1. Who's already doing something adjacent

### Payments/VAS incumbents (the rails already in the shops)

| Player | Offer | Traction (latest found) | Notes |
|---|---|---|---|
| **Flash (Pepkor)** | Prepaid airtime/electricity, vouchers, bill pay, POS device | ~**200,000 devices** at informal traders; dedicated field staff | The default "digital till" in spazas ([TechFinancials](https://techfinancials.co.za/2021/05/27/how-many-traders-are-helping-pepkors-flash-mobile-payments-to-make-money-in-the-townships/)) |
| **Kazang (Lesaka)** | VAS terminal + Kazang Pay card acceptance, cash withdrawals (TymeBank), DStv bill pay | ~**90,000 devices, ~3M transactions/day**; Lesaka ~R72bn throughput across 93,000+ merchants | Free terminal rental above a modest transaction threshold — the price anchor to compete against ([Ventureburn](https://ventureburn.com/2025/04/kazang-brings-card-payments-to-spaza-shops-driving-fintech-fuelled-financial-inclusion/)) |
| **Shop2Shop** | Closed-loop payments for informal trade; Standard Bank Instant Money network | Founding member of ASAPP (Jan 2025) | Building "transactional profiles" for credit access — merchant-side, not customer-side ([ITWeb](https://www.itweb.co.za/article/the-invisible-engine-powering-sas-informal-payment-revolution/PmxVE7KE2wrqQY85)) |
| **Yoco** | Card machines → full SME "digital toolkit" (POS, online payments, sales tracking) | **200,000+ merchants, R34bn+/yr** (2025); strongest in food/bev, retail, beauty | Serves the formal-ish end, not deep township; its device→OS move validates the thesis at a higher income tier ([Yoco blog](https://www.yoco.com/za/blog/unlocking-sme-growth-south-africa/)) |
| **iKhokha** | Card machines + business tools | Acquired by **Nedbank for ~R1.65bn (Aug 2025)**; R20bn+/yr processed | Banks are buying this space ([TechCabal](https://techcabal.com/2025/08/19/after-nedbank-93m-deal-ikhokha-to-run-as-per-normal/)) |
| **A2Pay** | POS + digital tools, digital credit, coaching | ~6,000+ merchants (2024); 3.5% default rate on credit | "Hardware + coaching + credit" bundle works but scales slowly ([BFA Global](https://bfaglobal.com/digital-spazas/insights/digital-innovations-to-build-the-resilience-of-south-african-spazas-the-case-of-a2pay/)) |

### Supply-side digitisers (mixed fates — the cautionary tales)

- **Yebo Fresh** — township grocery e-commerce, 5,000+ township businesses. Raised R78m, then **acquired by Smollan (Dec 2024)** — a soft landing, not an independent scale-up. Key struggle: **spaza cashflow — payment-on-delivery didn't work, high return rates** ([BFA Global](https://bfaglobal.com/digital-spazas/insights/digital-innovations-to-build-the-resilience-of-south-african-spazas-the-case-of-yebo-fresh-and-vuleka/)).
- **Vuleka** — bulk-buying app for spazas. Same cashflow struggles; little public activity after ~2023 (likely dormant).
- **Selpal** — township POS + FMCG supply chain, **acquired by FNB (2021)**, then quietly parked.
- **SpazaApp** — effectively gone from the record.
- **Pan-African**: **MarketForce/RejaReja shut down (April 2024)** after 270,000 merchants and $160m GTV on $42.5m raised — razor-thin FMCG margins, unsustainable unit economics. **Wasoko/MaxAB pivoted to fintech; TradeDepot to ads/data.** The "digitise informal retail supply" VC thesis broadly failed ([TechCrunch](https://techcrunch.com/2024/04/19/marketforce-winds-down-its-b2b-e-commerce-arm/)).

### Loyalty/CRM adjacent (closest direct competitors)

- **StampChat (stampchat.co.za)** — SA startup doing **digital loyalty stamp cards over WhatsApp**: QR at checkout, WhatsApp confirms the stamp; dashboard shows regulars, peak hours. **From R349/mo**, targets cafés, salons, barbers, car washes, takeaways. Essentially the loyalty module already in market — but single-merchant, no shared customer ID, no website ([StampChat](https://www.stampchat.co.za/)).
- **Magic Stamp, DigiStamp, Loopy Loyalty, Oappso** — more digital stamp-card players at the SMME end.
- **wiGroup/wiCode** — the closest historical precedent for a shared/interoperable loyalty-and-payments ID at till points. Grew to 150,000+ retail lanes, then merged into UK's **Yoyo (2020)** and disappeared as an SA consumer proposition. Interoperable loyalty rails found their exit serving *formal* enterprise retail, never cracked informal ([Finextra](https://www.finextra.com/pressarticle/84505/yoyo-to-create-global-loyalty-brand-following-merger-with-south-africas-wigroup)).
- **WhatsApp Business API ecosystem** — Clickatell, BizAI, ReachMax and dozens of local providers sell WhatsApp CRM/automation to SA SMEs; the free WhatsApp Business app caps broadcasts at 256 contacts — the natural upgrade trigger.

### Government context

After the 2024 child food-poisoning deaths, government forced a **national spaza registration drive**: 392 registration centres, 42,915 applications by Dec 2024, 1,000+ shops closed for non-compliance ([SAnews](https://www.sanews.gov.za/features-south-africa/guide-register-spaza-shops)). Registration/compliance help is now a live, government-forced need — a credible door-opener.

---

## 2. Informal economy realities (what shapes the product)

- **Market size**: township economy ~**R750bn** with **1.8m informal traders**. GG Alcock's counts: ~70,000 spazas + 30,000 spazarettes (R150bn+), **150,000 hair salons**, 50,000 kasi food outlets (R90bn), 500,000 hawkers.
- **Connectivity**: 50.8m internet users (78.9% penetration); smartphone cost and **data cost remain the top adoption barriers** ([DataReportal 2025](https://datareportal.com/reports/digital-2025-south-africa)).
- **WhatsApp is the platform**: most-used platform in SA; ~23h42m/month per user; light on data, works on cheap Androids.
- **Cash is still king**: of ~1.1m township MSMEs, **66% operate informally and on a cash basis** ([FinMark Trust](https://finmark.org.za/Publications/Community_Digitalisation_Pocket_Guide.pdf)).
- **Trust and informal credit**: spazas already run informal customer books — credit "on tick", rooted in interpersonal trust.
- **Practical implication**: the customer will not download an app. Registration realistically = **shop owner captures the customer's phone number at the till** (or customer scans a QR that opens WhatsApp — StampChat proved this flow). The phone number *is* the shared customer ID. Feature-phone customers can still be registered by the owner and reached by SMS/USSD fallback.

---

## 3. Loyalty behaviour in SA

- **85% of economically active South Africans use loyalty programmes**, averaging **10.4 programmes per person**; 26% rely on them for daily financial struggles ([Truth & BrandMapp 2025/6](https://whyfive.co.za/report/truth-and-brandmapp-2025-26-loyalty-whitepaper/)).
- **Instant, tangible value wins**: cashback is the #1 desired benefit; **41% want instant rewards** vs 39% points accumulation. Checkers Xtra Savings won by being instant and free.
- **Airtime/data as currency**: airtime functions as quasi-money at the bottom of the market — 10m+ South Africans use Vodacom Airtime Advance.
- **Caveat**: serving **low-income consumers is the unsolved loyalty problem** (Eighty20). For this market: reward with **airtime, data, electricity vouchers, or free product (the 10th kota free)** — instantly, on WhatsApp — not points.

---

## 4. Business model considerations

**What informal businesses actually pay for** (revealed preference):
- Things that put cash in the till today: VAS commissions, card acceptance with instant settlement, stock at better prices, working-capital credit.
- Kazang's free-terminal-above-threshold and Flash's commission model mean the informal merchant expects **zero/negative-cost hardware and pay-per-use**, not SaaS subscriptions. StampChat's R349/mo works for salons/cafés with card-paying regulars, likely too steep for a spaza.

**Why the failures failed** (recurring patterns):
1. **Razor-thin FMCG margins** — no room for a platform take (MarketForce, the whole B2B wave).
2. **Merchant cashflow reality** — payment-on-delivery and subscriptions collide with week-to-week cash cycles.
3. **VC-paced growth in a trust-paced market** — burn outran adoption; survivors got bought by banks or are corporate-backed.
4. **Infrastructure friction** — data costs, unreliable electricity, KYC/banking exclusion (especially migrant-owned shops).

**Distribution that works**: **field agents + community trust, not app-store downloads.** Flash explicitly credits its dedicated field staff; Moniepoint-style hybrid models drive uptake in low-literacy cash-heavy settings ([Afridigest](https://afridigest.com/agent-networks-driving-africas-digital-development/)). Skhokho Labs' existing agent-recruitment model maps directly onto this.

---

## 5. Opportunities / wedges

1. **WhatsApp loyalty as the Trojan horse.** "See who your regulars are, bring them back" — StampChat proves the mechanic; nobody has bundled it with a website + the network effect of a shared ID. The pitch to the owner is one sentence: *"When it's quiet, send a special to your 200 best customers on WhatsApp."*
2. **The shared customer ID (phone number) across the platform** is the genuine differentiator — but only if POPIA is handled correctly (consent per business, no cross-marketing without opt-in). The defensible version: the **customer** gets one profile and sees all their stamps/rewards across local shops in one WhatsApp thread — customer-side pull that single-merchant stamp apps can't match.
3. **Digitise "the book" (tick/credit records)** — recording who owes what is an existing daily pain with zero digital tooling. Careful: *recording* credit sales is fine; *becoming a credit provider or charging interest* triggers the NCA. The transaction history becomes a credit-scoring asset to monetise **with lenders/partners**, not by lending yourself.
4. **Compliance/registration tailwind** — help shops with municipal registration paperwork (post-2024 crackdown) as lead-gen.
5. **Stokvel and group-buying hooks** — 800,000+ stokvel groups, 11m members, R50bn/yr. A shop that registers its stokvel customers can take pre-orders for month-end bulk buys.
6. **The website matters more than it looks** — Facebook pages don't rank on Google for local search; most township businesses are invisible online. But sell it as the free bonus that comes with the loyalty tool, not the product.
7. **White space confirmation**: incumbents own payments (Kazang/Flash), supply (Smollan/Yebo Fresh), credit (banks). None owns the **merchant↔customer relationship layer**.

---

## 6. Avoid / Go-for list

### Avoid
- **Building payments or POS hardware.** 300k+ devices deployed with bank balance sheets behind them. Integrate or coexist; never compete on rails.
- **B2B supply/stock ordering.** The entire African cohort hit the same wall. Empirically dead.
- **A consumer app download.** Data cost, storage, habit all say WhatsApp + QR + phone number.
- **Monthly SaaS pricing as the only model for the spaza tier.** Cash cycles are weekly. Tier it: free/cheap entry, charge where card revenue exists (salons, taverns, takeaways), or monetise via reward-voucher margin and later data/credit partnerships.
- **Lending or charging for credit yourself** — NCA registration territory. Record credit; don't extend it.
- **Cross-merchant marketing without explicit opt-in.** POPIA: consent must be voluntary, specific, informed; the amended April 2025 regulations allow WhatsApp-captured consent (usefully!). The shared-ID dream dies legally if you treat one consent as platform-wide consent.
- **VC-paced blitzscaling.** Every survivor grew slowly with field agents or inside a corporate. Trust is the rate limiter.
- **Leading with "get a website".** For this segment a website is credibility garnish; discovery is WhatsApp/Facebook/word-of-mouth. (For Skhokho's *existing* formal-SME segment the website leads; for the informal segment, flip it.)

### Go for
- **WhatsApp-native loyalty + customer register, phone number as ID** — owner types a number or customer scans a QR; stamp/cashback confirmed in WhatsApp. Proven mechanic (StampChat), unproven at platform scale — that's the opening.
- **Instant, tangible rewards**: airtime/data/electricity vouchers and free product. Voucher margin is also a monetisation channel.
- **Start with salons, barbers, taverns/shisanyama and takeaways, not spazas.** Higher-margin, repeat-visit businesses with real retention pain and some ability to pay. Spazas come later via a free tier.
- **Digitised tick-book as the spaza hook** (record-only), building transaction history that later powers partner credit scoring.
- **Field-agent distribution** reusing Skhokho's agent/onboarder model — commission per activated shop, agents drawn from the community.
- **Customer-side pull via one wallet of rewards across local shops** — the only version of "shared customer ID" that creates a network effect rather than a privacy problem.
- **Stokvel/group-buy features and month-end campaign tools** timed to SA pay cycles.
- **Compliance-assist onboarding** (municipal registration help, POPIA-safe consent capture in the WhatsApp flow) as trust-building differentiators.
- **Design for the bank-acquisition endgame.** FNB bought Selpal, Nedbank bought iKhokha (R1.65bn) — a clean, consented customer-relationship dataset over the informal economy is exactly what they keep paying for.
