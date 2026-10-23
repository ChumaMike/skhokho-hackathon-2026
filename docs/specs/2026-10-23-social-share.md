# Social products, phase 1: Shareable

**Date:** 2026-10-23 · **Status:** built on `feature/social-share` (Tab 7, Storefront websites), awaiting merge · **Plan:** `docs/plans/2026-10-23-social-products.md` (phase 1 of four) · **Plan gating:** FREE, no feature key

Every product on a Skhokho storefront can be put on WhatsApp, Instagram, TikTok or Facebook with one tap, and looks right when it lands. This document says exactly what phase 1 does, what it deliberately does not do, and where the seams for phases 2 to 4 are.

## 1. What a customer gets

| On the storefront | What happens |
|---|---|
| **Share button** on the product page (labelled), on every product card (Shopfront grids and featured rows, the RETAIL_GRID collections row, the LEGACY design's cards) and on every FOOD_MENU row (a small round icon) | On a phone the browser's share sheet opens with the message below; where there is no share sheet (most desktop browsers) the message and link are copied and the button says "Link copied". Closing the sheet without choosing anything says nothing. |
| **The message** | Product name · price as `R 1 234.56` · shop name, then the hashtags on their own line, then the canonical product link (the shop's own domain when it has one, else `/store/<slug>/product/<id>`). |
| **Hashtags** on the product page | Each is a chip linking to that shop's tag page. |
| **Tag page** `/store/<slug>/tag/<tag>` (or `/tag/<tag>` on the shop's own domain) | That shop's live products carrying the tag, with the same cards as the Shop page. Indexable, in the sitemap, with an ItemList JSON-LD. `#Kota`, `kota` and `KOTA` are one page. A tag nobody uses is a 404 with noindex, never an empty page. |
| **The preview** when the link lands | A composed 1200×630 card in the shop's colour: photo (or the product's initial), name, price, the shop's logo (or initial) and name, hashtags. |

The merchant's preview (`/preview`) renders outside the live storefront layout and shows no share button, so nobody shares a preview address.

## 2. What a merchant gets

- **Hashtags box** in the catalogue editor, under name and description: up to eight, typed any way ("#kota #soweto" or "kota, soweto"). They are stored bare and lower case (letters in any script, digits and underscores, 30 characters max), de-duplicated, in the merchant's order. The catalogue list shows a product's tags.
- **Share count** per product: "Shared N times" under the price in the catalogue list; a **Shares** total for the chosen window and a **Most shared** list (top five, all-time) on Dashboard › Storefront › Page analytics; "Hashtag pages" as one line in the per-page table.
- Nothing to switch on. It is there for every plan.

## 3. What is counted, and what is not

A share is counted **once, server side, when the share sheet or the copy completes** (`POST /api/store/share` with the shop and product ids and nothing else). Two counters move: the product's own `shareCount`, and the day's `PRODUCT_SHARE` counter in the same privacy-aware daily stats as views and taps. Nothing about the customer is received or kept: no identity, no cookie, no destination app, no IP stored (the per-IP rate limit holds it in memory only). The response is always 204 and never says whether anything was counted. Browsers cannot send `PRODUCT_SHARE` through the analytics beacon; it stays server-counted, like orders. A hidden product, another shop's product or a made-up id counts nothing.

Hashtags are the merchant's own words about their own product. They never cross shops: a tag page is one shop's page; nothing aggregates tags across shops. This keeps every count and every link inside the tenant, within the POPIA s57 line the plan sets.

## 4. How it is built

| Piece | Where | Note |
|---|---|---|
| The one rule for hashtags and the share message | `src/lib/storefront/share.ts` | Pure; used by the editor, the service, the page, the button, the sitemap and the card, so what is typed, stored, shown and shared is always the same thing. |
| Share button and its context | `src/components/storefront/share/` | `StorefrontShareProvider` in the store layout gives every button the shop id, name and canonical origin once; cards need no new props. |
| Product fields | `Product.hashtags String[]`, `Product.shareCount Int` | Inside the Product model with Tab 7 doc comments (a column lives in its model, not under the end-of-file marker). Migrations `20261023150000_product_hashtags`, `20261023150100_product_share_count`, both additive. |
| Tag page | `src/app/store/[slug]/tag/[tag]/page.tsx` | Same catalogue read as the Shop page; booking shell for booking storefronts; LEGACY design and shops without products 404. `tag` is a reserved page slug. |
| Share card | `src/app/store/[slug]/product/[productId]/share-image/route.tsx` | next/og `ImageResponse` (bundled in Next, no new dependency); cached a day; per-IP limit; the product page's Open Graph image points at it with a version token that changes when name, price, photo, shop name or logo change, so an edit replaces the cached card. |
| Share count | `src/app/api/store/share/route.ts` | Strict body, per-IP limit, tenant-host check, ACTIVE shop, live product. |
| Analytics | `src/modules/storefront-learning/page-analytics.ts` | `totals.shares`, `mostShared`, the "Hashtag pages" line (page key `TAG`). |

Rate-limit buckets added (appended to `RATE_RULES`): `shareImageIp` 60/min, `shareCountIp` 30/min.

## 5. Known limits

- The card's headings render in one weight: next/og bundles a single weight of Noto Sans and the repository carries no font files. A bundled bold face is a small follow-up if the pilot wants it heavier.
- The storefront does not show a product's share count to customers. Phase 2's "most loved" badge is where a merchant-controlled public number belongs.
- A share sheet reports success when the customer picked a target, not when the message was sent. Copying counts as a share. Both are the honest best a browser can tell us.
- Instagram and TikTok accept the message text but do not always keep the link in a caption; that is theirs, not ours. The card still shows wherever the link is pasted.

## 6. Not in phase 1, on purpose

Reactions, saves, comments, following a product, trending and the Discover page (phases 2 to 4). Posting to a customer's social account on their behalf. Any public identity for a customer. Any count across shops tied to a person.

## 7. Tests

`share.test` (hashtag rule, message, tag matching, card version), `catalog.service.test` (tags tidied in, replaced on update, read back), `learning.test` and `page-analytics.test` (tag page key, shares in totals), `share-image/route.db.test` (a real 1200×630 PNG with the cache header; hidden, unknown and other-shop 404), `api/store/share/route.db.test` (counts move once per completed share; everything else counts nothing and still gets 204).
