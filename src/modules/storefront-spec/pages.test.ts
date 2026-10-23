import test from "node:test";
import assert from "node:assert/strict";
import type { BusinessCategory } from "@prisma/client";
import { BUSINESS_CATEGORIES } from "@/lib/business-categories";
import { getBusinessCapabilities } from "@/modules/tenant/capabilities";
import { getBusinessExperience } from "@/modules/tenant/business-experience";
import { resolveStorefrontVariant } from "@/modules/tenant/shopfront-eligibility";
import {
  BUILT_IN_SLUGS,
  RESERVED_PAGE_SLUGS,
  SiteSchema,
  defaultSitePages,
  getStorefrontPages,
  pageHasContent,
  resolveFooterItems,
  resolveNavItems,
  type PageContentFacts,
  type SiteDefaultsInput,
  type SitePage,
} from "./pages";
import { addCustomPage, addSection, movePage, removePage, sectionFromInput, setPageSections, updatePageHeader, PageEditError } from "./pages-edit";
import { parseSpec } from "./spec";
import { projectSpec } from "./project";
import type { WorkflowId } from "@/modules/storefront-workflows/workflows";
import { resolveSite } from "./site";
import { previewBasePath } from "@/app/preview/storefront/[revisionId]/preview";
import { buildRulesSpec } from "./planner";
import type { StorefrontFacts } from "./facts";

function defaultsFor(category: BusinessCategory, workflows: WorkflowId[] = []): SiteDefaultsInput {
  const business = { category, settings: null };
  return {
    category,
    capabilities: getBusinessCapabilities(business),
    variant: resolveStorefrontVariant(business),
    catalogLabel: getBusinessExperience(category).catalogLabel,
    workflows,
  };
}

const FULL: PageContentFacts = { productCount: 3, serviceCount: 2, imageCount: 4, reviewCount: 1, hasAbout: true, hasContact: true, workflows: [] };
const EMPTY: PageContentFacts = { productCount: 0, serviceCount: 0, imageCount: 0, reviewCount: 0, hasAbout: false, hasContact: false, workflows: [] };

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

test("every category gets a valid default page set with home first and the built-in pages", () => {
  for (const [category] of BUSINESS_CATEGORIES) {
    const pages = defaultSitePages(defaultsFor(category));
    const parsed = SiteSchema.safeParse({ pages });
    assert.ok(parsed.success, `${category}: ${parsed.success ? "" : parsed.error.issues[0]?.message}`);
    assert.equal(pages[0].kind, "HOME");
    for (const id of ["ABOUT", "CONTACT", "GALLERY", "REVIEWS", "POLICY_PRIVACY"]) {
      assert.ok(pages.some((p) => p.id === id), `${category} is missing ${id}`);
    }
  }
});

test("catalogue pages follow the business's capabilities and variant", () => {
  const food = defaultSitePages(defaultsFor("FOOD_VENDOR"));
  assert.deepEqual(
    food.filter((p) => p.kind === "CATALOGUE").map((p) => [p.id, p.slug, p.title]),
    [["CATALOGUE_PRODUCTS", "shop", "Menu"]],
  );
  const salon = defaultSitePages(defaultsFor("SALON"));
  assert.deepEqual(
    salon.filter((p) => p.kind === "CATALOGUE").map((p) => [p.id, p.slug]),
    [["CATALOGUE_SERVICES", "services"]],
  );
  // A mechanic sells parts and offers services: both pages, services first (booking variant).
  const mechanic = defaultSitePages(defaultsFor("MECHANIC"));
  assert.deepEqual(
    mechanic.filter((p) => p.kind === "CATALOGUE").map((p) => [p.id, p.title]),
    [
      ["CATALOGUE_SERVICES", "Services"],
      ["CATALOGUE_PRODUCTS", "Parts"],
    ],
  );
  const retail = defaultSitePages(defaultsFor("RETAIL_STORE"));
  assert.equal(retail.find((p) => p.id === "CATALOGUE_PRODUCTS")?.title, "Shop");
});

test("policy pages match what the business does and start empty, out of the menu, in the footer", () => {
  const retail = defaultSitePages(defaultsFor("RETAIL_STORE"));
  const policies = retail.filter((p) => p.kind === "POLICY");
  assert.deepEqual(
    policies.map((p) => p.id),
    ["POLICY_RETURNS", "POLICY_DELIVERY", "POLICY_PRIVACY"],
  );
  for (const p of policies) {
    assert.equal(p.inNav, false);
    assert.equal(p.inFooter, true);
  }
  assert.deepEqual(retail.find((p) => p.id === "POLICY_RETURNS")?.sections, []);
  const salon = defaultSitePages(defaultsFor("SALON"));
  assert.ok(salon.some((p) => p.id === "POLICY_CANCELLATIONS"));
  assert.ok(!salon.some((p) => p.id === "POLICY_RETURNS"));
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

test("the schema refuses reserved, duplicate and moved built-in slugs, and unsafe text", () => {
  const base = defaultSitePages(defaultsFor("RETAIL_STORE"));
  const custom = (over: Partial<SitePage>): SitePage => ({
    id: "page-x",
    kind: "CUSTOM",
    slug: "x",
    title: "X",
    visible: true,
    inNav: true,
    inFooter: false,
    sections: [{ type: "TEXT", heading: null, body: "Hello" }],
    ...over,
  });

  assert.equal(SiteSchema.safeParse({ pages: [...base, custom({ slug: "checkout" })] }).success, false, "reserved slug");
  assert.equal(SiteSchema.safeParse({ pages: [...base, custom({ slug: "about" })] }).success, false, "duplicate of a built-in");
  assert.equal(SiteSchema.safeParse({ pages: base.map((p) => (p.id === "ABOUT" ? { ...p, slug: "story" } : p)) }).success, false, "built-in slug moved");
  assert.equal(SiteSchema.safeParse({ pages: base.filter((p) => p.kind !== "HOME") }).success, false, "no home");
  assert.equal(
    SiteSchema.safeParse({ pages: [...base, custom({ sections: [{ type: "TEXT", heading: null, body: "See <b>here</b>" }] })] }).success,
    false,
    "markup",
  );
  assert.equal(
    SiteSchema.safeParse({ pages: [...base, custom({ sections: [{ type: "TEXT", heading: null, body: "Visit https://x.test" }] })] }).success,
    false,
    "links",
  );
  assert.equal(SiteSchema.safeParse({ pages: [...base, custom({ slug: "our-team" })] }).success, true);
  for (const slug of Object.values(BUILT_IN_SLUGS)) if (slug) assert.ok(RESERVED_PAGE_SLUGS.has(slug), `${slug} must be reserved`);
});

// ---------------------------------------------------------------------------
// Content gating, nav and footer
// ---------------------------------------------------------------------------

test("nav and footer only list pages that can open and have something to show", () => {
  const pages = defaultSitePages(defaultsFor("RETAIL_STORE"));
  const nav = resolveNavItems(pages, "/store/kota", FULL).map((i) => i.href);
  assert.deepEqual(nav, ["/store/kota", "/store/kota/shop", "/store/kota/about", "/store/kota/gallery", "/store/kota/reviews", "/store/kota/contact"]);

  // Nothing uploaded yet: gallery, reviews, about and contact drop out; policies stay empty, so the footer only has the privacy pointer.
  const bare = resolveNavItems(pages, "", EMPTY).map((i) => i.href);
  assert.deepEqual(bare, ["/"]);
  assert.deepEqual(
    resolveFooterItems(pages, "", EMPTY).map((i) => i.href),
    ["/your-privacy"],
  );

  // Once the owner writes a returns policy it appears in the footer, not the menu.
  const written = setPageSections(pages, "POLICY_RETURNS", [{ type: "TEXT", heading: null, body: "Bring it back within 7 days with your slip." }]);
  assert.ok(resolveFooterItems(written, "", FULL).some((i) => i.href === "/returns"));
  assert.ok(!resolveNavItems(written, "", FULL).some((i) => i.href === "/returns"));
  assert.equal(pageHasContent(written.find((p) => p.id === "POLICY_RETURNS")!, EMPTY), true);
});

test("a published page set is re-checked against today's capabilities", () => {
  const defaults = defaultsFor("RETAIL_STORE");
  const published = { version: 1, pages: defaultSitePages(defaults) };
  const live = getStorefrontPages({ settings: { storefrontPages: published } }, defaults);
  assert.ok(live.some((p) => p.id === "CATALOGUE_PRODUCTS"));

  // Products switched off: the Shop page is gone, even though it was published.
  const noProducts = { ...defaults, capabilities: new Set(["LOYALTY" as const]), workflows: [] };
  const after = getStorefrontPages({ settings: { storefrontPages: published } }, noProducts);
  assert.ok(!after.some((p) => p.id === "CATALOGUE_PRODUCTS"));

  // Garbage in settings falls back to the defaults, never throws.
  assert.equal(getStorefrontPages({ settings: { storefrontPages: { version: 1, pages: "nope" } } }, defaults).length, defaultSitePages(defaults).length);
});

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

test("owner edits: move, rename, add, remove, sections", () => {
  let pages = defaultSitePages(defaultsFor("RETAIL_STORE"));
  const order = () => pages.map((p) => p.id);

  // Home never moves and nothing moves above it.
  pages = movePage(pages, "CATALOGUE_PRODUCTS", "up");
  assert.equal(order()[0], "HOME");
  assert.equal(order()[1], "CATALOGUE_PRODUCTS");
  pages = movePage(pages, "ABOUT", "up");
  assert.deepEqual(order().slice(0, 3), ["HOME", "ABOUT", "CATALOGUE_PRODUCTS"]);

  // Built-in pages keep their slug even if the form posts one.
  pages = updatePageHeader(pages, "ABOUT", { title: "Our story", slug: "story", visible: true, inNav: true, inFooter: false });
  assert.equal(pages.find((p) => p.id === "ABOUT")?.slug, "about");
  assert.equal(pages.find((p) => p.id === "ABOUT")?.title, "Our story");
  // Policy pages may move address, but not onto a reserved or taken one.
  pages = updatePageHeader(pages, "POLICY_RETURNS", { title: "Returns", slug: "refunds", visible: true, inNav: false, inFooter: true });
  assert.equal(pages.find((p) => p.id === "POLICY_RETURNS")?.slug, "refunds");
  assert.throws(() => updatePageHeader(pages, "POLICY_RETURNS", { title: "Returns", slug: "basket", visible: true, inNav: false, inFooter: true }), PageEditError);
  assert.throws(() => updatePageHeader(pages, "POLICY_RETURNS", { title: "Returns", slug: "about", visible: true, inNav: false, inFooter: true }), PageEditError);

  // Custom pages: slug from the title, start hidden, can be deleted; built-ins can't.
  pages = addCustomPage(pages, "Our Team!");
  const team = pages.find((p) => p.id === "page-our-team");
  assert.ok(team);
  assert.equal(team.slug, "our-team");
  assert.equal(team.visible, false);
  assert.throws(() => addCustomPage(pages, "Checkout"), PageEditError);
  assert.throws(() => removePage(pages, "ABOUT"), PageEditError);

  pages = addSection(pages, "page-our-team", { type: "TEXT", heading: "Who we are", body: "Two sisters and a van.\n\nSince 2019." });
  pages = addSection(pages, "page-our-team", { type: "FAQ", faq: "Do you deliver?\nYes, within 10 km.\n\nCard?\nYes." });
  const sections = pages.find((p) => p.id === "page-our-team")!.sections;
  assert.equal(sections.length, 2);
  assert.deepEqual(sections[1], { type: "FAQ", items: [{ q: "Do you deliver?", a: "Yes, within 10 km." }, { q: "Card?", a: "Yes." }] });
  assert.throws(() => addSection(pages, "page-our-team", { type: "CATALOGUE" }), PageEditError, "catalogue is not addable to a custom page");
  assert.throws(() => sectionFromInput({ type: "FAQ", faq: "A question with no answer" }), PageEditError);
  // The core section of a built-in page can't be removed.
  assert.throws(() => setPageSections(pages, "CONTACT", [{ type: "HOURS" }]), PageEditError);
  pages = removePage(pages, "page-our-team");
  assert.ok(!pages.some((p) => p.id === "page-our-team"));
  assert.ok(SiteSchema.safeParse({ pages }).success);
});

// ---------------------------------------------------------------------------
// Spec round trip
// ---------------------------------------------------------------------------

function facts(category: BusinessCategory): StorefrontFacts {
  return {
    name: "Kota Tainment",
    slug: "kota-tainment",
    category,
    description: "Kotas, chips and cold drinks.",
    location: { suburb: "Soweto", city: "Johannesburg", province: "Gauteng" },
    capabilities: [...getBusinessCapabilities({ category, settings: null })],
    contact: { phone: true, whatsapp: true, email: false, address: true },
    brand: { primaryColor: "#9A5A0A", accentColor: "#1F6F5C", hasLogo: true, hasBanner: true },
    products: { count: 4, withImages: 2, sampleNames: ["Kota"] },
    services: { count: 0, withImages: 0, sampleNames: [] },
    hoursConfigured: true,
    deliveryEnabled: true,
    reviewCount: 0,
    profile: {},
    brief: null,
    current: { template: "PRODUCT", templateId: null, content: { version: 1, hero: {}, about: {}, highlights: { items: [] }, process: [] }, site: null },
    imageCount: 2,
    workflows: [],
  };
}

test("the rules spec carries the pages, publishing projects them, and old specs without pages still parse", () => {
  const f = facts("FOOD_VENDOR");
  const spec = buildRulesSpec(f, "GENERATE");
  assert.ok(spec.site && spec.site.pages.length > 0);
  assert.ok(parseSpec(spec).ok);

  const projection = projectSpec({ capabilities: ["PRODUCTS", "ORDERS"] }, spec, "rev_1");
  const stored = projection.settings.storefrontPages as { version: number; pages: SitePage[] };
  assert.equal(stored.version, 1);
  assert.equal(stored.pages.length, spec.site!.pages.length);
  assert.deepEqual(projection.settings.capabilities, ["PRODUCTS", "ORDERS"]);

  // A later spec that keeps `site` from the published pages (ASSIST and GENERATE both do).
  const published = { ...f, current: { ...f.current, site: { pages: stored.pages.slice(0, 1).concat(stored.pages.slice(1).map((p) => ({ ...p, title: `${p.title}!` }))) } } };
  assert.equal(buildRulesSpec(published, "GENERATE").site?.pages[1].title.endsWith("!"), true);

  // Specs saved before pages existed parse, and publishing them leaves live pages alone.
  const legacy = { ...spec };
  delete (legacy as { site?: unknown }).site;
  assert.ok(parseSpec(legacy).ok);
  const keep = projectSpec({ storefrontPages: { version: 1, pages: stored.pages } }, parseSpec(legacy).ok ? (parseSpec(legacy) as { ok: true; spec: typeof spec }).spec : spec, "rev_2");
  assert.deepEqual(keep.settings.storefrontPages, { version: 1, pages: stored.pages });
});

test("the resolved site ends its nav and footer with the customer's Account link (Tab 3's route)", () => {
  const business = {
    id: "b1",
    category: "RETAIL_STORE" as const,
    settings: null,
    description: "Clothes.",
    phone: "+27111234567",
    whatsapp: null,
    email: null,
    address: null,
    suburb: "Soweto",
    city: null,
  };
  const site = resolveSite(business, "/store/kota", { productCount: 3, serviceCount: 0, imageCount: 1, reviewCount: 0 });
  assert.deepEqual(site.nav.at(-1), { id: "ACCOUNT", label: "Account", href: "/store/kota/account" });
  assert.deepEqual(site.footer.at(-1), { id: "ACCOUNT", label: "Account", href: "/store/kota/account" });
  assert.equal(site.nav.filter((i) => i.id === "ACCOUNT").length, 1);
  assert.equal(previewBasePath("rev_1"), "/preview/storefront/rev_1");
});
