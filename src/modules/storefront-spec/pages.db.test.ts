import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { clearHostnameCache } from "@/lib/tenant/context";
import { editDraftSite, ensureWorkingDraft, getOpenDraft, publishRevision, InvalidEditError } from "./revision.service";
import { getPublishedSite } from "./pages";
import { addCustomPage, addSection, setPageSections } from "./pages-edit";
import { loadSite, openablePage } from "./site";

/**
 * Owner pages against a real database: the working draft, saving pages into
 * it, publishing, and what the storefront then serves. Fixture businesses
 * carry a unique suffix and are removed in `after`. No model is called.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const created: string[] = [];

async function makeRetail(label = "a") {
  const b = await prisma.business.create({
    data: {
      name: `Pages ${label} ${run}`,
      slug: `pg-${label}-${run}`,
      category: "RETAIL_STORE",
      status: "ACTIVE",
      description: "Clothes and sneakers.",
      whatsapp: "+27821234567",
      settings: {},
    },
  });
  created.push(b.id);
  await prisma.product.create({ data: { businessId: b.id, name: `Cap ${run}`, price: 150, imageUrl: "https://example.test/cap.jpg" } });
  return b;
}

test.beforeEach(clearHostnameCache);
test.after(async () => {
  if (created.length > 0) {
    await prisma.storefrontRevision.deleteMany({ where: { businessId: { in: created } } });
    await prisma.product.deleteMany({ where: { businessId: { in: created } } });
    await prisma.business.deleteMany({ where: { id: { in: created } } });
  }
});

test("page edits go into one working draft and reach the storefront only when published", async () => {
  const business = await makeRetail();

  // Nothing published: the storefront serves the defaults; policies are empty so they don't open.
  const before = await loadSite(business, `/store/${business.slug}`);
  assert.deepEqual(
    before.nav.map((i) => i.label),
    ["Home", "Shop", "About", "Gallery", "Contact", "Account"],
  );
  assert.equal(openablePage(before, "returns"), null);
  assert.equal(await getOpenDraft(business.id), null);

  // The first edit starts a draft from the live storefront; the second reuses it.
  const draft = await ensureWorkingDraft(business.id, null);
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.source, "RULES");
  assert.ok(draft.spec.site && draft.spec.site.pages.length > 0);
  assert.equal((await ensureWorkingDraft(business.id, null)).id, draft.id);

  let pages = draft.spec.site!.pages;
  pages = setPageSections(pages, "POLICY_RETURNS", [{ type: "TEXT", heading: null, body: "Bring it back within 7 days with your slip and we'll swap or refund it." }]);
  pages = addCustomPage(pages, "Our team");
  pages = addSection(pages, "page-our-team", { type: "TEXT", heading: null, body: "Two sisters and a van." });
  pages = pages.map((p) => (p.id === "page-our-team" ? { ...p, visible: true } : p));
  const saved = await editDraftSite(business.id, draft.id, { pages });
  assert.equal(saved.spec.site?.pages.find((p) => p.id === "POLICY_RETURNS")?.sections.length, 1);
  assert.equal(saved.validation.ok, true, JSON.stringify(saved.validation.errors));

  // Still nothing live.
  const fresh = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  assert.equal(getPublishedSite(fresh), null);

  // Unsafe or unroutable pages are refused before anything is stored.
  await assert.rejects(
    editDraftSite(business.id, draft.id, { pages: pages.map((p) => (p.id === "page-our-team" ? { ...p, slug: "checkout" } : p)) }),
    InvalidEditError,
  );
  await assert.rejects(
    editDraftSite(business.id, draft.id, {
      pages: pages.map((p) => (p.id === "page-our-team" ? { ...p, sections: [{ type: "TEXT", heading: null, body: "<script>alert(1)</script>" }] } : p)),
    }),
    InvalidEditError,
  );

  // Publish: pages are projected into settings and the storefront serves them.
  await publishRevision(business.id, draft.id, null);
  const live = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  const published = getPublishedSite(live);
  assert.ok(published);
  assert.ok(published.pages.some((p) => p.id === "page-our-team"));

  const after = await loadSite(live, `/store/${live.slug}`);
  assert.ok(after.nav.some((i) => i.href === `/store/${live.slug}/our-team`));
  assert.ok(after.footer.some((i) => i.href === `/store/${live.slug}/returns`));
  assert.equal(openablePage(after, "returns")?.id, "POLICY_RETURNS");
  assert.equal(openablePage(after, "our-team")?.kind, "CUSTOM");
  // Hidden pages and pages with nothing to show don't open.
  assert.equal(openablePage(after, "delivery"), null);
  assert.equal(openablePage(after, "reviews"), null);

  // Another business can't touch this draft.
  const other = await makeRetail("b");
  await assert.rejects(editDraftSite(other.id, draft.id, { pages }));
});
