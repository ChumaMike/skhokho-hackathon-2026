import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { clearHostnameCache } from "@/lib/tenant/context";
import { resetTestDb } from "@/lib/testing/db";
import { POST as leadPOST } from "@/app/api/store/lead/route";
import { changeBusinessPlan } from "@/modules/billing/subscription.service";
import { loadSite, openablePage } from "@/modules/storefront-spec/site";
import { countOpenLeads, getLead, listLeads, setLeadNotes, setLeadStatus } from "./leads.service";

/**
 * Workflows against a real database: plan gating end to end, the public
 * form, the inbox. Fixture businesses carry a unique suffix and are removed
 * in `after`. No email is sent (EMAIL transport is not configured in tests)
 * and no model is called.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const created: string[] = []; // ids, for assertions only; cleanup is resetTestDb

async function makeMechanic(label: string) {
  const b = await prisma.business.create({
    data: {
      name: `Fix ${label} ${run}`,
      slug: `fx-${label}-${run}`,
      category: "MECHANIC",
      status: "ACTIVE",
      description: "Brakes and clutches.",
      whatsapp: "+27821234567",
      phone: "+27111234567",
      settings: {},
    },
  });
  created.push(b.id);
  await prisma.service.create({ data: { businessId: b.id, name: `Brake service ${run}`, price: 850, duration: 60 } });
  return b;
}

function post(host: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new NextRequest(`https://${host}/api/store/lead`, {
    method: "POST",
    body: form,
    headers: { host, "x-forwarded-for": `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  });
}

// registerCustomer writes append-only identity rows (consents, visits) that
// only TRUNCATE can clear, so this file resets the whole test database like
// the other identity-touching suites do (lib/testing/db.ts).
test.before(resetTestDb);
test.beforeEach(clearHostnameCache);
test.after(resetTestDb);

test("a quote request is plan-gated, saved with a notification, and worked from the inbox", async () => {
  const business = await makeMechanic("a");
  const host = "skhokho.sgdataint.co.za";
  const base = { businessId: business.id, workflow: "QUOTE_REQUEST", returnTo: `/store/${business.slug}/quote`, consent: "on", name: "Thabo", phone: "082 123 4567", message: "Brakes squealing." };

  // FREE plan: the quote page doesn't exist and the API refuses.
  const free = await loadSite(business, `/store/${business.slug}`);
  assert.equal(free.workflows.length, 0);
  assert.equal(openablePage(free, "quote"), null);
  const refused = await leadPOST(post(host, base));
  assert.equal(refused.status, 303);
  assert.match(refused.headers.get("location") ?? "", /err=/);
  assert.equal(await prisma.storefrontLead.count({ where: { businessId: business.id } }), 0);

  // GROW includes advanced_storefront: the page appears and the form works.
  await changeBusinessPlan(business.id, "GROW");
  const grow = await loadSite(business, `/store/${business.slug}`);
  assert.deepEqual(grow.workflows, ["QUOTE_REQUEST", "CALLBACK_REQUEST"]);
  assert.equal(openablePage(grow, "quote")?.kind, "ACTION");
  assert.ok(grow.nav.some((i) => i.href.endsWith("/quote")));

  const ok = await leadPOST(post(host, { ...base, about: "2015 Polo", serviceName: `Brake service ${run}` }));
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get("location") ?? "", /ok=lead/);

  const leads = await listLeads(business.id, { status: "OPEN" });
  assert.equal(leads.length, 1);
  const lead = leads[0];
  assert.equal(lead.kind, "QUOTE_REQUEST");
  assert.equal(lead.status, "NEW");
  assert.equal(lead.customerName, "Thabo");
  assert.deepEqual(lead.details, { about: "2015 Polo" });
  assert.equal(lead.serviceName, `Brake service ${run}`);
  assert.ok(lead.membershipId, "the phone number was registered as a customer of this business");
  assert.equal(await countOpenLeads(business.id), 1);

  const notification = await prisma.businessNotification.findFirst({ where: { businessId: business.id, type: "new_lead" } });
  assert.ok(notification);
  // Counted against the page the form was on — the quote page itself here (step 6's page keys).
  const stat = await prisma.storefrontDailyStat.findFirst({ where: { businessId: business.id, event: "LEAD_SUBMITTED" } });
  assert.equal(stat?.page, "page:quote");
  assert.equal(lead.pageSlug, "quote");

  // Bad input never reaches storage.
  const bad = await leadPOST(post(host, { ...base, message: "<script>alert(1)</script>" }));
  assert.match(bad.headers.get("location") ?? "", /err=/);
  const honeypot = await leadPOST(post(host, { ...base, website: "http://spam" }));
  assert.match(honeypot.headers.get("location") ?? "", /err=/);
  assert.equal(await prisma.storefrontLead.count({ where: { businessId: business.id } }), 1);

  // Status and notes, scoped to the business.
  const quoted = await setLeadStatus(business.id, lead.id, "QUOTED");
  assert.equal(quoted.status, "QUOTED");
  assert.ok(quoted.handledAt);
  await setLeadNotes(business.id, lead.id, "Quoted R850.");
  assert.equal((await getLead(business.id, lead.id))?.ownerNotes, "Quoted R850.");
  const other = await makeMechanic("b");
  assert.equal(await getLead(other.id, lead.id), null);
  await assert.rejects(setLeadStatus(other.id, lead.id, "WON"));

  // A workflow the business hasn't switched on is refused even on GROW.
  const pickup = await leadPOST(post(host, { ...base, workflow: "PICKUP_REQUEST", address: "x", preferredDate: "2026-11-03", timeWindow: "MORNING" }));
  assert.match(pickup.headers.get("location") ?? "", /err=/);
});
