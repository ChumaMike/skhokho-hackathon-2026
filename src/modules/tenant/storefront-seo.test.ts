import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStorefrontMetadata,
  buildLocalBusinessJsonLd,
  serializeJsonLd,
  buildPageMetadata,
  buildProductJsonLd,
  buildProductListJsonLd,
  buildServiceListJsonLd,
  buildSitemapXml,
  buildRobotsTxt,
  noindexMetadata,
  NOINDEX_PATHS,
} from "@/modules/tenant/storefront-seo";

const BASE_BUSINESS = {
  name: "Beauty by Nomsa",
  slug: "beauty-by-nomsa",
  description: null as string | null,
  category: "SALON" as const,
  bannerUrl: null as string | null,
  logoUrl: null as string | null,
  suburb: "Soweto" as string | null,
  city: "Johannesburg" as string | null,
};

test("buildStorefrontMetadata falls back to category + location when description is missing, never invents marketing copy", () => {
  const meta = buildStorefrontMetadata(BASE_BUSINESS, "HOME");
  assert.equal(meta.description, "Beauty by Nomsa — Salon / Hair in Soweto.");
});

test("buildStorefrontMetadata uses the business's own description when present", () => {
  const meta = buildStorefrontMetadata({ ...BASE_BUSINESS, description: "Braids, relaxers, and nail care." }, "HOME");
  assert.equal(meta.description, "Braids, relaxers, and nail care.");
});

test("buildStorefrontMetadata titles a sub-page with its own name, not a generic suffix", () => {
  const meta = buildStorefrontMetadata(BASE_BUSINESS, "GALLERY");
  assert.equal(meta.title, "Gallery — Beauty by Nomsa");
});

test("buildStorefrontMetadata omits openGraph/twitter images when no bannerUrl or logoUrl is set, rather than a broken image tag", () => {
  const meta = buildStorefrontMetadata(BASE_BUSINESS, "HOME");
  assert.equal((meta.openGraph as { images?: unknown[] })?.images, undefined);
  assert.equal((meta.twitter as { card?: string })?.card, "summary");
});

test("buildStorefrontMetadata includes an image when bannerUrl is set", () => {
  const meta = buildStorefrontMetadata({ ...BASE_BUSINESS, bannerUrl: "https://example.test/banner.jpg" }, "HOME");
  assert.deepEqual((meta.openGraph as { images?: { url: string }[] })?.images, [{ url: "https://example.test/banner.jpg" }]);
  assert.equal((meta.twitter as { card?: string })?.card, "summary_large_image");
});

const JSONLD_BUSINESS = {
  name: "Beauty by Nomsa",
  slug: "beauty-by-nomsa",
  description: "Braids, relaxers, and nail care.",
  phone: "011 123 4567",
  address: "12 Khumalo Street",
  suburb: "Soweto",
  city: "Johannesburg",
  province: "Gauteng",
  postalCode: "1818",
};

test("buildLocalBusinessJsonLd never includes aggregateRating when there are no published reviews", () => {
  const json = buildLocalBusinessJsonLd(JSONLD_BUSINESS, { average: 0, count: 0 });
  assert.equal("aggregateRating" in json, false);
});

test("buildLocalBusinessJsonLd never includes aggregateRating when rating is omitted entirely", () => {
  const json = buildLocalBusinessJsonLd(JSONLD_BUSINESS);
  assert.equal("aggregateRating" in json, false);
});

test("buildLocalBusinessJsonLd includes aggregateRating only once real published reviews exist", () => {
  const json = buildLocalBusinessJsonLd(JSONLD_BUSINESS, { average: 4.5, count: 12 });
  assert.deepEqual(json.aggregateRating, { "@type": "AggregateRating", ratingValue: 4.5, reviewCount: 12 });
});

test("buildLocalBusinessJsonLd maps suburb+city to addressLocality and province to addressRegion, dropping neither (regression: both suburb and city previously wrote to addressRegion, silently discarding whichever came second)", () => {
  const json = buildLocalBusinessJsonLd(JSONLD_BUSINESS);
  const address = json.address as Record<string, string>;
  assert.equal(address.addressLocality, "Soweto, Johannesburg");
  assert.equal(address.addressRegion, "Gauteng");
});

test("buildLocalBusinessJsonLd omits the address block entirely when a business has set no location fields", () => {
  const json = buildLocalBusinessJsonLd({ ...JSONLD_BUSINESS, address: null, suburb: null, city: null });
  assert.equal("address" in json, false);
});

test("serializeJsonLd escapes a literal </script> so a business-controlled field can never break out of the <script> tag", () => {
  const malicious = { name: "Evil</script><script>alert(1)</script>" };
  const serialized = serializeJsonLd(malicious);
  assert.equal(serialized.includes("</script>"), false);
  assert.equal(JSON.parse(serialized.replace(/\\u003c/g, "<")).name, malicious.name);
});

test("serializeJsonLd output round-trips through JSON.parse unchanged", () => {
  const json = buildLocalBusinessJsonLd(JSONLD_BUSINESS, { average: 4.5, count: 12 });
  const serialized = serializeJsonLd(json);
  assert.deepEqual(JSON.parse(serialized), json);
});

test("buildLocalBusinessJsonLd always sets @context/@type/name/url", () => {
  const json = buildLocalBusinessJsonLd(JSONLD_BUSINESS);
  assert.equal(json["@context"], "https://schema.org");
  assert.equal(json["@type"], "LocalBusiness");
  assert.equal(json.name, "Beauty by Nomsa");
  assert.ok(typeof json.url === "string" && (json.url as string).includes("beauty-by-nomsa"));
});

// ---------------------------------------------------------------------------
// Tab 7, step 5: per-page metadata, structured data for the catalogue,
// sitemap and robots per storefront, noindex for personal paths
// ---------------------------------------------------------------------------

test("buildPageMetadata: the owner's own search listing wins, else the page title and an honest description; image falls back banner -> logo", () => {
  const plain = buildPageMetadata({ ...BASE_BUSINESS, logoUrl: "https://example.test/logo.png" }, { title: "Returns and refunds", path: "/returns", description: "Bring it back within 7 days." });
  assert.equal(plain.title, "Returns and refunds — Beauty by Nomsa");
  assert.equal(plain.description, "Bring it back within 7 days.");
  assert.match(String((plain.alternates as { canonical?: string }).canonical), /\/store\/beauty-by-nomsa\/returns$/);
  assert.deepEqual((plain.openGraph as { images?: { url: string }[] }).images, [{ url: "https://example.test/logo.png" }]);
  assert.equal(plain.robots, undefined);

  const owned = buildPageMetadata(BASE_BUSINESS, { title: "Gallery", path: "/gallery", seo: { title: "Braids by Nomsa in Soweto", description: "Box braids, knotless and cornrows — see our work." } });
  assert.equal(owned.title, "Braids by Nomsa in Soweto");
  assert.equal(owned.description, "Box braids, knotless and cornrows — see our work.");

  const product = buildPageMetadata(BASE_BUSINESS, { title: "Edge control", path: "/product/p1", image: "https://example.test/edge.jpg" });
  assert.deepEqual((product.openGraph as { images?: { url: string }[] }).images, [{ url: "https://example.test/edge.jpg" }]);
  assert.deepEqual(noindexMetadata("Basket").robots, { index: false, follow: false });
  assert.deepEqual([...NOINDEX_PATHS], ["basket", "checkout", "account", "configure"]);
});

test("product and service structured data carry a ZAR offer only when a price is set, and never a rating", () => {
  const business = { name: "Beauty by Nomsa", slug: "beauty-by-nomsa" };
  const product = buildProductJsonLd(business, { id: "p1", name: "Edge control", description: "Strong hold.", imageUrl: "https://example.test/edge.jpg", images: [], price: "85.00" });
  assert.equal(product["@type"], "Product");
  assert.deepEqual(product.image, ["https://example.test/edge.jpg"]);
  assert.deepEqual(product.offers, { "@type": "Offer", price: "85.00", priceCurrency: "ZAR", availability: "https://schema.org/InStock", url: product.url });
  assert.equal("aggregateRating" in product, false);
  const free = buildProductJsonLd(business, { id: "p2", name: "Sample", description: null, imageUrl: null, images: [], price: "0" });
  assert.equal("offers" in free, false);
  assert.equal("image" in free, false);

  const services = buildServiceListJsonLd(business, [{ id: "s1", name: "Box braids", description: null, imageUrl: null, price: 450 }]);
  assert.equal(services.numberOfItems, 1);
  const first = (services.itemListElement as { item: Record<string, unknown> }[])[0].item;
  assert.equal(first["@type"], "Service");
  assert.equal((first.offers as { price: string }).price, "450.00");
  const list = buildProductListJsonLd(business, [{ id: "p1", name: "Edge control", description: null, imageUrl: null, images: [], price: "85" }]);
  assert.equal((list.itemListElement as { url: string }[])[0].url.endsWith("/product/p1"), true);
});

test("sitemap and robots: escaped, canonical, personal paths disallowed, sitemap pointed at", () => {
  const xml = buildSitemapXml([{ loc: "https://x.test/store/a", lastmod: new Date("2026-10-21T10:00:00Z") }, { loc: "https://x.test/store/a/shop?c=1&d=2" }]);
  assert.match(xml, /<loc>https:\/\/x.test\/store\/a<\/loc><lastmod>2026-10-21<\/lastmod>/);
  assert.match(xml, /shop\?c=1&amp;d=2/);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));

  const own = buildRobotsTxt("", "https://www.nomsa.co.za/sitemap.xml");
  assert.equal(own, "User-agent: *\nDisallow: /basket\nDisallow: /checkout\nDisallow: /account\nDisallow: /configure\nAllow: /\nSitemap: https://www.nomsa.co.za/sitemap.xml\n");
  const platform = buildRobotsTxt("/store/beauty-by-nomsa", "https://skhokho.test/store/beauty-by-nomsa/sitemap.xml");
  assert.match(platform, /Disallow: \/store\/beauty-by-nomsa\/checkout/);
  assert.match(platform, /Allow: \/store\/beauty-by-nomsa\n/);
});
