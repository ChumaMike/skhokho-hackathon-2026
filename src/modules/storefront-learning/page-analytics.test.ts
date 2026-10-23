import test from "node:test";
import assert from "node:assert/strict";
import { getBusinessCapabilities } from "@/modules/tenant/capabilities";
import { defaultSitePages } from "@/modules/storefront-spec/pages";
import { classifyStorefrontPath } from "@/components/storefront/StorefrontBeacon";
import { ClientEventSchema, pageKeyForSlug } from "./events";
import { buildPageAnalytics, type PageStatRow } from "./page-analytics";

const row = (event: string, page: string, count: number, device = ""): PageStatRow => ({ event, page, device, count });

test("every storefront address has a counter key: fixed names for routed pages, page:<slug> for the owner's pages", () => {
  assert.equal(pageKeyForSlug(""), "HOME");
  assert.equal(pageKeyForSlug("shop"), "SHOP");
  assert.equal(pageKeyForSlug("returns"), "page:returns");
  assert.equal(pageKeyForSlug("quote"), "page:quote");
  // The beacon sends the same keys, and only well-formed slugs.
  assert.deepEqual(classifyStorefrontPath("/store/kota/returns", "/store/kota"), { page: "page:returns" });
  assert.deepEqual(classifyStorefrontPath("/services", ""), { page: "page:services" });
  assert.equal(classifyStorefrontPath("/store/kota/Returns", "/store/kota"), null);
  assert.equal(classifyStorefrontPath("/store/kota/returns/extra", "/store/kota"), null);
  // The API accepts them and nothing else.
  assert.equal(ClientEventSchema.safeParse({ type: "PAGE_VIEW", page: "page:our-team" }).success, true);
  assert.equal(ClientEventSchema.safeParse({ type: "PAGE_VIEW", page: "page:Our Team" }).success, false);
  assert.equal(ClientEventSchema.safeParse({ type: "PAGE_VIEW", page: "page:" }).success, false);
  assert.equal(ClientEventSchema.safeParse({ type: "PAGE_VIEW", page: "ANYTHING" }).success, false);
});

test("page analytics: one row per page in the owner's order, taps and enquiries per page, phone share, totals, and honest leftovers", () => {
  const caps = getBusinessCapabilities({ category: "MECHANIC", settings: null });
  const pages = defaultSitePages({ category: "MECHANIC", capabilities: caps, variant: "BOOKING", catalogLabel: "Parts", workflows: ["QUOTE_REQUEST"] });
  const rows: PageStatRow[] = [
    row("PAGE_VIEW", "HOME", 30, "MOBILE"),
    row("PAGE_VIEW", "HOME", 10, "DESKTOP"),
    row("CTA_CLICK", "HOME", 7),
    row("ENQUIRY_CLICK", "HOME", 2),
    row("PAGE_VIEW", "page:quote", 12, "MOBILE"),
    row("LEAD_SUBMITTED", "page:quote", 4),
    row("PAGE_VIEW", "page:services", 9),
    row("PAGE_VIEW", "PRODUCT", 5, "MOBILE"),
    row("PAGE_VIEW", "page:old-page", 3),
    row("PAGE_VIEW", "BASKET", 2),
    row("ORDER_PLACED", "CHECKOUT", 1),
    row("BOOKING_SUBMITTED", "HOME", 2),
  ];
  const live = new Set(["HOME", "CATALOGUE_SERVICES", "ACTION_QUOTE_REQUEST"]);
  const a = buildPageAnalytics(rows, pages, live, "/store/fixit", 30);

  assert.equal(a.pages[0].id, "HOME");
  assert.deepEqual({ views: a.pages[0].views, taps: a.pages[0].primaryTaps, enquiries: a.pages[0].enquiries, phone: a.pages[0].phoneShare }, { views: 40, taps: 7, enquiries: 2, phone: 75 });
  const quote = a.pages.find((p) => p.id === "ACTION_QUOTE_REQUEST")!;
  assert.deepEqual({ views: quote.views, enquiries: quote.enquiries, path: quote.path, live: quote.live }, { views: 12, enquiries: 4, path: "/store/fixit/quote", live: true });
  const services = a.pages.find((p) => p.id === "CATALOGUE_SERVICES")!;
  assert.equal(services.views, 9);
  assert.equal(services.phoneShare, null, "no device classified → no share claimed");
  const about = a.pages.find((p) => p.id === "ABOUT")!;
  assert.deepEqual({ views: about.views, live: about.live }, { views: 0, live: false });
  assert.equal(a.pages.at(-1)?.id, "PRODUCT");
  assert.equal(a.pages.at(-1)?.views, 5);
  assert.equal(a.otherViews, 3, "a renamed page's views are reported, not dropped; basket is not");
  assert.deepEqual(a.totals, { views: 71, primaryTaps: 7, enquiries: 6, orders: 1, bookings: 2, phoneShare: Math.round((47 / 57) * 100) });
  assert.equal(a.days, 30);
});
