# Storefronts as full business websites — audit and plan

**Workstream:** Tab 7 (`feature/storefront-websites`, off `feature/storefront-domain-foundation`)
**Date:** 2026-10-21
**Status:** Step 1 of 7 (audit). Later steps update the "Delivery" section as they land.

## Scope note

The tab prompt says "21 business categories". `src/lib/business-categories.ts`
and the `BusinessCategory` enum in `prisma/schema.prisma` hold **twelve**
(SALON, FOOD_VENDOR, CAR_WASH, RETAIL_STORE, TUCK_SHOP, MECHANIC,
HAIR_BRAIDER, NAIL_TECHNICIAN, EVENTS, CHILDCARE, LAUNDRY, OTHER). The
category classifier and the capability defaults agree on the same twelve.
This audit covers those twelve. If more categories are planned, they need
an enum migration first, which is outside this tab's surface.

## How a storefront is chosen today (verified in code)

1. **Variant** — `resolveStorefrontVariant` (`shopfront-eligibility.ts`): a
   published spec's template wins while it still fits the business's
   capabilities; otherwise the eight services categories get `BOOKING`
   (centred nav, services section with booking forms) and everything else
   gets `PRODUCT` (top-right nav, featured grid, Shop page). `LEGACY` only
   when an owner opted into the old `StorefrontView`.
2. **Library template** — only when a spec is generated (AI or rules):
   `chooseTemplateId` maps vertical FOOD → `FOOD_MENU`, SALON/SERVICES →
   `SALON_BOOKING` if the business has SERVICES + BOOKINGS else
   `SERVICES_LEAD` (needs WhatsApp or phone), RETAIL → classic (null).
3. **Capabilities** — `DEFAULT_CAPABILITIES_BY_CATEGORY` decides which
   buttons can exist at all (ORDER needs PRODUCTS + ORDERS, BOOK needs
   SERVICES + BOOKINGS).
4. **Workflow** — exactly one of: order (basket → checkout), book (slot
   picker → `/api/store/book`), or enquire (WhatsApp / call link). Nothing
   else lands anywhere in the dashboard.
5. **Pages** — Home, Shop (products only), About, Contact. The Gallery route
   exists but 404s for every Shopfront business (it is gated by the old
   `storefront-templates.ts` page list, which only the LEGACY design reads).
   Reviews appear only as one quote on Home. No policy pages. The footer is
   fixed copy with no owner links and no legal slot.
6. **Terminology** — `business-experience.ts` only changes labels
   (Menu / Products / Parts). It never changes structure or workflow.

## Per-category audit

Legend for "Fits today": ✔ the existing three templates serve the business
well; ◐ workable but the wrong emphasis; ✘ the template misleads customers
or leaves the main job undone.

| Category | Variant · template · default capabilities | Workflow today | Fits today |
|---|---|---|---|
| SALON | BOOKING · SALON_BOOKING · SERVICES, BOOKINGS, LOYALTY | book | ✔ |
| HAIR_BRAIDER | BOOKING · SALON_BOOKING · SERVICES, BOOKINGS, LOYALTY | book | ✔ |
| NAIL_TECHNICIAN | BOOKING · SALON_BOOKING · SERVICES, BOOKINGS, LOYALTY | book | ✔ |
| FOOD_VENDOR | PRODUCT · FOOD_MENU · PRODUCTS, ORDERS, PICKUP, LOYALTY | order | ✔ |
| TUCK_SHOP | PRODUCT · FOOD_MENU (FOOD vertical) · PRODUCTS, ORDERS, PICKUP, LOYALTY | order | ◐ |
| RETAIL_STORE | PRODUCT · classic (no library template) · PRODUCTS, ORDERS, LOYALTY | order | ◐ |
| CAR_WASH | BOOKING · SALON_BOOKING · SERVICES, BOOKINGS, LOYALTY | book | ◐ |
| MECHANIC | BOOKING · SALON_BOOKING · SERVICES, BOOKINGS, PRODUCTS, LOYALTY | book | ✘ |
| EVENTS | BOOKING · SALON_BOOKING · SERVICES, BOOKINGS | book | ✘ |
| CHILDCARE | BOOKING · SALON_BOOKING · SERVICES, BOOKINGS | book | ✘ |
| LAUNDRY | BOOKING · SERVICES_LEAD (no BOOKINGS) or classic · SERVICES, ORDERS, PICKUP | enquire | ✘ |
| OTHER | PRODUCT · by catalogue (MIXED/RETAIL/SERVICES) · broadest set | order or book | ◐ |

### SALON, HAIR_BRAIDER, NAIL_TECHNICIAN — fits ✔

- **Today:** services with price and duration, each with a booking form;
  About and Contact pages; WhatsApp shortcut; loyalty join link as a
  secondary action.
- **A real one needs:** a price list by style or treatment, a gallery of
  work (braiders and nail techs live on photos), booking with a chosen
  time, a visible way to ask "can you fit me in" when the diary is full,
  trading hours, location, reviews, a cancellation or deposit note written
  by the owner.
- **Gap:** no Gallery page (route 404s for Shopfront businesses); reviews
  are one quote, not a page; no waitlist or callback when fully booked; no
  owner-written cancellation note; hours only appear as an open/closed bar
  for ORDERS businesses, not on Contact.

### FOOD_VENDOR — fits ✔

- **Today:** compact banner, whole menu grouped by category with option
  groups, basket bar, order for collection or delivery, open/closed bar.
- **A real one needs:** exactly that, plus delivery areas and fees in plain
  words, a delivery and collection policy, specials, photos of the food,
  loyalty.
- **Gap:** no delivery policy page, no owner-editable hours page, no
  gallery; per-page search listing is Home only.

### TUCK_SHOP — workable ◐

- **Today:** treated as FOOD for template choice, so it gets the menu list.
  Labels say "Products".
- **A real one needs:** a quick price list, what's in stock today, hours,
  location, WhatsApp orders, a stamp card. The menu list is actually a good
  price list, so the composition holds.
- **Gap:** sold-out and sort order are Tab 5's controls (we render them);
  no hours page; no delivery policy for the ones that drop off locally.

### RETAIL_STORE — workable ◐

- **Today:** classic Shopfront: featured grid on Home, Shop page with
  category chips and search, product detail, basket, checkout.
- **A real one needs:** collections (categories) as the way in, filters,
  featured and new items, several photos per product, sizes or variants,
  returns and delivery policies customers can find before they pay, product
  search listings, payment trust.
- **Gap:** no collections-first composition (`RETAIL_GRID`, step 4); no
  returns or delivery page (step 2); no product structured data or per-page
  SEO (step 5); variants are a catalogue question outside this tab.

### CAR_WASH — workable ◐

- **Today:** booking-first (SALON_BOOKING). Loyalty is a default
  capability but only appears as a secondary link.
- **A real one needs:** a price list by vehicle size, hours and location
  first (most customers drive in), a loyalty card that is the main hook
  ("every sixth wash free"), and for mobile valets a "come to me" request
  with address and time window.
- **Gap:** no pickup/collect request (step 3); the stamp card deserves a
  page or section; booking should be optional, not the headline.

### MECHANIC — does not fit ✘

- **Today:** SALON_BOOKING: book a time slot for "Brake service". Parts
  can appear on a Shop page.
- **A real one needs:** a quote request with photos and vehicle details
  (make, model, year, the problem), a list of services, a callback option,
  trust written by the owner (years, specialisms), before and after work
  photos, location and hours, reviews.
- **Gap:** quote workflow with photos and a dashboard inbox (step 3);
  `SERVICE_PORTFOLIO` composition with process and work gallery (step 4);
  reviews page (step 2).

### EVENTS — does not fit ✘

- **Today:** SALON_BOOKING: a 60-minute slot for "Wedding décor".
- **A real one needs:** an enquiry with the event date, headcount, venue
  or area and budget band; packages; a portfolio gallery; testimonials; a
  short "how it works"; a quote request with inspiration photos.
- **Gap:** enquiry and quote workflows (step 3); `SERVICE_PORTFOLIO`
  (step 4); gallery and reviews pages (step 2).

### CHILDCARE — does not fit ✘

- **Today:** SALON_BOOKING: book a slot for "Aftercare".
- **A real one needs:** an enrolment enquiry (child's age, start date, days
  needed), fees, hours, the programme and the people (About), safety
  information the owner writes, photos, location, a waitlist when full.
- **Gap:** enquiry with date and headcount and a waitlist (step 3); hours
  and policy pages (step 2); gallery page.

### LAUNDRY — does not fit ✘

- **Today:** no BOOKINGS by default, so the generated template is
  SERVICES_LEAD (WhatsApp per service) or classic; ORDERS + PICKUP are on
  but the basket is product-only, so "order" means nothing here.
- **A real one needs:** a price list per kilogram or item, a pickup and
  drop-off request with address and time window, turnaround times, a quote
  for bulk or special items, hours.
- **Gap:** pickup request and quote request workflows (step 3); delivery
  and turnaround policy page (step 2).

### OTHER — generic ◐

- **Today:** PRODUCT variant unless a published spec says otherwise;
  vertical follows the catalogue; broadest capability set.
- **A real one needs:** whatever it is. The honest answer is the classic
  Shopfront plus every page and workflow switched on by capability, so an
  owner can shape it without a category.
- **Gap:** the same cross-cutting gaps below; nothing category-specific.

## Cross-cutting gaps → delivery steps

| Gap | Step |
|---|---|
| No owner-controlled pages, nav or footer links; Gallery and Reviews unreachable; no policy pages | 2 |
| Only order, book, WhatsApp; quotes, enquiries, pickups, callbacks go nowhere | 3 |
| Retail and portfolio businesses have no fitting composition; no per-section layout choice | 4 |
| SEO is Home-only; no sitemap per storefront; no Product/Service structured data; basket and checkout indexable | 5 |
| Owners cannot see per-page views, taps or enquiries | 6 |
| Only AI drafts are previewed; page edits have no phone/desktop preview before going live | 7 |

## Older unmerged branches (requested by the product tab)

Checked with `git cherry` and the feature branch's log on 2026-10-21. All
five were squash-merged into `main` and are already inside
`feature/storefront-domain-foundation`; none has a patch the feature
branch lacks.

| Branch | Landed as | Verdict |
|---|---|---|
| `storefront/m4-multi-page-routes` | PR #61 (M4) | Superseded. Its About/Gallery/Contact routes, `StorefrontPageShell`, Hours/Reviews/Gallery sections and `storefront-templates.ts` are in the feature branch; the Shopfront redesign later bypassed its page gating. |
| `storefront/m5-templates-and-wizard` | PR #62 (M5) | Superseded. The four legacy templates and wizard picker are present; the spec engine's `templates.ts` library is the live successor. |
| `storefront/m5b-storefront-seo` | PR #66 (A6) | Superseded. `storefront-seo.ts` (metadata, JSON-LD, `serializeJsonLd`) is in the feature branch and is the base step 5 extends. |
| `storefront/m6-ai-generation-fallback` | PR #63 (M6/A4) | Superseded. `template-generation-provider.ts` landed and was revised afterwards (41 lines differ in the feature branch's favour). |
| `storefront/nav-and-dead-fields` | PR #73 | Superseded. `StorefrontNav` is present verbatim. It only serves the LEGACY design; step 2 replaces hard-coded Shopfront nav links with the page model. |

Nothing to cherry-pick. The branches can be deleted after the user
confirms; this tab does not delete branches.

## Design decisions for steps 2–7 (binding for this tab)

- **Pages live in the storefront spec**, not a new table. A `site.pages`
  list is added to `StorefrontSpec` (optional, so every stored revision
  still parses). `projectSpec` writes it to `Business.settings.storefrontPages`
  on publish; readers call `getStorefrontPages(business)`, which returns
  sanitised pages or the category defaults when nothing is published. This
  gives step 7 (preview, publish) the existing revision model for free and
  keeps every storefront read at zero extra queries.
- **Built-in pages keep their routes** (`/shop`, `/about`, `/contact`,
  `/gallery`); policy, reviews, workflow and custom pages render under
  `/store/<slug>/<page>` through one `[page]` route. Reserved slugs are
  refused by the schema. The custom domain path is unchanged because the
  middleware already rewrites every tenant-host path under `/store/<slug>`.
- **Workflows are capabilities** (`QUOTES`, `ENQUIRIES`, `PICKUP_REQUESTS`,
  `CALLBACKS`) with category defaults, and are plan-gated by the existing
  `advanced_storefront` feature key (GROW and PRO). No new feature key or
  plan rows, so Tab 4's packaging is untouched. Leads land in a new
  `StorefrontLead` table under `// ---- Tab 7 ----`.
- **Nobody edits HTML or CSS.** Owners choose from validated section types,
  layouts and text fields. Policy text is the owner's; this tab writes no
  legal copy and leaves the footer slot for Tab 2's ECTA block.
- **Colours stay the merchant's.** New sections use the existing
  `--shop-*` tokens from `resolveShopfrontTokens`; the console uses the
  DESIGN.md palette.

## Delivery

- [x] Step 1 — this audit.
- [x] Step 2 — owner-controlled pages. `spec.site` (pages.ts) with Home,
  Shop/Menu/Services, About, Contact, Gallery, Reviews and policy pages
  (returns, delivery or cancellations, privacy pointer); rendered by the
  built-in routes and `/store/<slug>/[page]`; nav and footer built from
  it; editor at Dashboard › Storefront › Pages saving into the working
  draft; publish from the list. Policy pages start empty and stay hidden
  until the owner writes them (no legal text written by this tab).
- [x] Step 3 — category workflows and the leads inbox. Four workflows in
  `storefront-workflows/workflows.ts` (quote request with photos, enquiry
  with date and headcount, pickup request, callback), each a capability
  (`QUOTES`, `ENQUIRIES`, `PICKUP_REQUESTS`, `CALLBACKS`) with category
  defaults, plan-gated by `advanced_storefront`. Each renders as a page
  (`/quote`, `/enquire`, `/pickup`, `/callback`) and an `ACTION` section;
  `ENQUIRE` is a primary action whose button leads to the primary
  workflow. Submissions post to `/api/store/lead` (honeypot, rate limit,
  host binding, plan check, photo upload) and land in `storefront_leads`;
  owners work them in Dashboard › Enquiries with status, notes, WhatsApp
  reply and call. Owners switch workflows on and off under Dashboard ›
  Storefront › Customer actions. Migration `20261022130000_storefront_leads`.
- [x] Step 4 — RETAIL_GRID and SERVICE_PORTFOLIO, per-section layouts.
  Two more compositions in `templates.ts`: RETAIL_GRID (collection tiles
  from the owner's categories, featured row, filters on Shop via
  `?collection=`) and SERVICE_PORTFOLIO (photo-first service cards, work
  gallery with grid / before-and-after pairs / strip, the owner's own
  "how it works" steps in `content.process`, real reviews, and the
  request form as the way out). Retail now lands on RETAIL_GRID; a
  quoting mechanic, events or childcare business on SERVICE_PORTFOLIO.
  Per-section layouts (`layouts.ts`) validated by the spec per base:
  catalogue GRID / LIST / MENU / COLLECTIONS or CARDS / LIST / PORTFOLIO,
  trust bar BAR / TILES, about SPLIT / STACKED, reviews QUOTE / LIST;
  gallery, reviews and catalogue page sections take layouts too. The six
  style presets are unchanged.
- [x] Step 5 — per-page SEO, sitemap, structured data, noindex. Every
  page has a title, description, canonical and Open Graph image (banner,
  else logo, else the product's own photo) via `buildPageMetadata`; the
  owner can set a search title and description per page in the page
  editor (`SitePage.seo`). `/store/<slug>/sitemap.xml` and `robots.txt`
  per storefront, served at `/sitemap.xml` and `/robots.txt` on the
  merchant's own host by the middleware. JSON-LD: LocalBusiness on Home
  (existing), Product on the product page, ItemList of Products on Shop
  and of Services on the Services page, ZAR offers only when a price is
  set. Basket, checkout, account and configure are noindex (metadata on
  the basket page, `X-Robots-Tag` headers for all four on both URL
  shapes, and robots.txt disallows), without editing Tab 3's pages.
- [x] Step 6 — page analytics in Dashboard › Storefront. Every storefront
  address now has a counter key (`HOME`, `SHOP`, … or `page:<slug>` for
  services, reviews, policies, request forms and custom pages); the
  beacon sends it and request forms count `LEAD_SUBMITTED` against the
  page they were on. `page-analytics.ts` turns the existing daily
  counters into one row per page (views, taps on the main button,
  enquiries = WhatsApp/call taps + forms sent, share from phones) with
  totals and an honest line for renamed or removed pages. Shown at
  Dashboard › Storefront › Page analytics for 7, 30 or 90 days, with the
  existing insights underneath. No visitor is ever identified.
- [x] Step 7 — preview and publish for any page. The preview route now
  renders every page of a draft at its own address
  (`/preview/storefront/<id>/<slug>`), with the nav staying inside the
  preview so the owner can browse the whole draft; products, basket and
  checkout point to the live store. Dashboard › Storefront › Pages shows
  the draft home at phone and desktop widths with Publish and Discard;
  each page's editor shows that page the same way with Publish; the AI
  draft page links to every other page of the draft. All on the existing
  revision model: edit → draft → preview → publish.

## Open items at hand-over (2026-10-21)

- **Test database.** This tab runs its DB tests on its own database on
  the test server, `skhokho_platform_test_storefront` (created with the
  user's go on 2026-10-21; this worktree's `.env.local` `TEST_*` variables
  point at it; all migrations applied with `prisma migrate deploy`, which
  also exercised `20261022130000_storefront_leads`). `pages.db.test.ts`
  and `leads.db.test.ts` both pass there. The shared
  `skhokho_platform_test` was not touched.
- **Plan gating — decided 2026-10-21.** Workflows gate on
  `advanced_storefront`. The platform billing tab had removed that key
  from every plan's entitlement rows; the user chose to **reinstate it on
  GROW and PRO** rather than add a dedicated key. The two
  `plan_entitlements` rows are Tab 4's packaging and are restored on that
  tab's branch; this tab's code is unchanged and needs nothing further.
  Until those rows land, request forms and the Enquiries inbox stay
  hidden for every plan; nothing breaks.
- **Shared Prisma client.** The worktrees share the main checkout's
  `node_modules`, so `prisma generate` from any tab overwrites the client
  the others typecheck against. The coordinator is moving each worktree
  to its own install; this branch's `StorefrontLead` model needs a
  generate wherever it is typechecked.
- **Tab 3 placements (done at rebase).** Tab 3's `<RewardsCard>` from
  `components/storefront/account` now sits below the hero on both home
  variants, replacing the stub; an "Account" link is the last nav and
  footer item, pointing at `/account`, which Tab 3's route serves.
- **Footer legal slot (done at rebase).** The four shells pass Tab 2's
  `<EctaInformation business={business} tone="dark" />` through
  `ShopfrontFooter`'s `legal` prop, so the ECTA block renders once per
  page and the footer itself still writes no legal text.
