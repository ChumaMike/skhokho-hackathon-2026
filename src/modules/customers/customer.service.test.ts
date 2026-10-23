import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "@/lib/testing/db";

/**
 * Calls register_customer directly via testDb, mirroring loyalty.test.ts's
 * convention — exercises the real Postgres function (this migration's
 * p_email/p_consent_marketing addition), not a mock of it.
 */

interface RegisterResult {
  public_id: string;
  short_code: string;
  display_name: string | null;
  created: boolean;
}

async function makeBusiness(slug: string) {
  return testDb.business.create({ data: { name: `Consent Test ${slug}`, slug } });
}

async function registerMember(
  businessId: string,
  phone: string,
  email: string | null = null,
  consentMarketing = false,
): Promise<RegisterResult> {
  const rows = await testDb.$queryRaw<{ result: RegisterResult }[]>`
    SELECT register_customer(${businessId}::uuid, ${phone}, NULL, 'test', NULL, NULL, ${email}, ${consentMarketing}) AS result`;
  return rows[0].result;
}

test("register_customer without email/consent (the pre-existing call shape) behaves exactly as before", async () => {
  const business = await makeBusiness(`no-email-${Date.now()}`);
  const reg = await registerMember(business.id, "+27821112222");

  const identifiers = await testDb.customerIdentifier.findMany({
    where: { customerId: (await customerIdFor(reg.public_id)) },
  });
  assert.ok(!identifiers.some((i) => i.type === "email"));

  const consents = await testDb.consent.findMany({
    where: { customerId: (await customerIdFor(reg.public_id)) },
  });
  assert.ok(!consents.some((c) => c.purpose === "marketing"));
  assert.ok(consents.some((c) => c.purpose === "loyalty_program"), "loyalty_program consent is still auto-granted");
});

test("register_customer with an email adds a customer_identifiers row (type = email)", async () => {
  const business = await makeBusiness(`with-email-${Date.now()}`);
  const reg = await registerMember(business.id, "+27821112223", "test@example.test");

  const identifiers = await testDb.customerIdentifier.findMany({
    where: { customerId: await customerIdFor(reg.public_id) },
  });
  const emailIdentifier = identifiers.find((i) => i.type === "email");
  assert.equal(emailIdentifier?.value, "test@example.test");
});

test("register_customer never overwrites an existing email identifier on a later call", async () => {
  const business = await makeBusiness(`no-overwrite-${Date.now()}`);
  const reg = await registerMember(business.id, "+27821112224", "first@example.test");
  await registerMember(business.id, "+27821112224", "second@example.test");

  const identifiers = await testDb.customerIdentifier.findMany({
    where: { customerId: await customerIdFor(reg.public_id), type: "email" },
  });
  assert.equal(identifiers.length, 1);
  assert.equal(identifiers[0].value, "first@example.test");
});

test("register_customer with consentMarketing:true grants a separate 'marketing' consent, independent of the auto-granted loyalty_program one", async () => {
  const business = await makeBusiness(`marketing-consent-${Date.now()}`);
  const reg = await registerMember(business.id, "+27821112225", null, true);

  const consents = await testDb.consent.findMany({
    where: { customerId: await customerIdFor(reg.public_id) },
  });
  assert.ok(consents.some((c) => c.purpose === "marketing"));
  assert.ok(consents.some((c) => c.purpose === "loyalty_program"));
});

test("re-affirming marketing consent on a later order appends a new consent row rather than upserting", async () => {
  const business = await makeBusiness(`marketing-ledger-${Date.now()}`);
  const reg = await registerMember(business.id, "+27821112226", null, true);
  await registerMember(business.id, "+27821112226", null, true);

  const marketingConsents = await testDb.consent.findMany({
    where: { customerId: await customerIdFor(reg.public_id), purpose: "marketing" },
  });
  assert.equal(marketingConsents.length, 2, "each explicit opt-in is its own append-only row");
});

async function customerIdFor(publicId: string): Promise<string> {
  const membership = await testDb.membership.findUniqueOrThrow({ where: { publicId } });
  return membership.customerId;
}
