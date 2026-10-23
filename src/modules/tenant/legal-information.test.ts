import test from "node:test";
import assert from "node:assert/strict";
import { buildEctaInformation, getLegalInformation, legalInformationGaps, validateLegalInformation, LEGAL_LIMITS } from "./legal-information";
import { TERMS_VERSION, PRIVACY_VERSION } from "@/lib/legal/documents";

const shop = {
  name: "Mzansi Eats",
  settings: null as unknown,
  phone: "+27 82 111 2222",
  whatsapp: null as string | null,
  email: null as string | null,
  address: "12 Vilakazi St",
  suburb: "Orlando West",
  city: "Soweto",
  province: "Gauteng",
  postalCode: "1804",
};

test("legal-information: reads settings.legal defensively (missing, wrong shape, blank strings → null)", () => {
  assert.deepEqual(getLegalInformation({ settings: null }), { legalName: null, registrationNumber: null, returnsText: null, complaintsContact: null });
  assert.deepEqual(getLegalInformation({ settings: { legal: "nope" } }), { legalName: null, registrationNumber: null, returnsText: null, complaintsContact: null });
  assert.deepEqual(getLegalInformation({ settings: { legal: { legalName: "  ", returnsText: 42 } } }), { legalName: null, registrationNumber: null, returnsText: null, complaintsContact: null });
  const l = getLegalInformation({ settings: { legal: { legalName: " Mzansi Eats (Pty) Ltd ", registrationNumber: "2024/123456/07", returnsText: "No returns on food.", complaintsContact: "help@mzansi.test" } } });
  assert.equal(l.legalName, "Mzansi Eats (Pty) Ltd");
  assert.equal(l.registrationNumber, "2024/123456/07");
});

test("legal-information: gaps — legal name and returns text are always required; complaints contact falls back to the shop's contacts", () => {
  assert.deepEqual(legalInformationGaps({ ...shop }), ["legalName", "returnsText"]);
  assert.deepEqual(legalInformationGaps({ ...shop, phone: null }), ["legalName", "returnsText", "complaintsContact"]);
  assert.deepEqual(legalInformationGaps({ ...shop, settings: { legal: { legalName: "Mzansi Eats (Pty) Ltd", returnsText: "No returns on prepared food." } } }), []);
  assert.deepEqual(legalInformationGaps({ ...shop, phone: null, settings: { legal: { legalName: "X", returnsText: "Y", complaintsContact: "0821112222" } } }), []);
});

test("legal-information: validation trims, enforces lengths and rejects odd registration numbers", () => {
  const ok = validateLegalInformation({ legalName: " Thandi Nkosi ", registrationNumber: "", returnsText: "Cancel free up to 24 hours before.", complaintsContact: " 082 111 2222 " });
  assert.deepEqual(ok, { legalName: "Thandi Nkosi", registrationNumber: null, returnsText: "Cancel free up to 24 hours before.", complaintsContact: "082 111 2222" });
  assert.throws(() => validateLegalInformation({ legalName: "x".repeat(LEGAL_LIMITS.legalName + 1) }), /Legal name must be/);
  assert.throws(() => validateLegalInformation({ returnsText: "x".repeat(LEGAL_LIMITS.returnsText + 1) }), /Returns and cancellation text must be/);
  assert.throws(() => validateLegalInformation({ registrationNumber: "<script>" }), /Registration number may only contain/);
  assert.throws(() => validateLegalInformation({ complaintsContact: "x".repeat(LEGAL_LIMITS.complaintsContact + 1) }), /Complaints contact must be/);
});

test("ecta block: falls back to the trading name and the shop's contacts, and says so", () => {
  const info = buildEctaInformation(shop);
  assert.equal(info.legalName, "Mzansi Eats");
  assert.equal(info.tradingAs, null);
  assert.equal(info.usingTradingNameAsLegalName, true);
  assert.equal(info.addressLine, "12 Vilakazi St, Orlando West, Soweto, Gauteng 1804");
  assert.equal(info.complaintsContact, "+27 82 111 2222");
  assert.equal(info.returnsText, null);
  assert.deepEqual(info.terms, { path: "/terms", version: TERMS_VERSION });
  assert.deepEqual(info.privacy, { path: "/privacy", version: PRIVACY_VERSION });
});

test("ecta block: shows 'trading as' only when the legal name differs, prefers WhatsApp then phone then email for complaints", () => {
  const filled = { ...shop, settings: { legal: { legalName: "Mzansi Eats (Pty) Ltd", registrationNumber: "2024/123456/07", returnsText: "No returns on prepared food." } } };
  const a = buildEctaInformation({ ...filled, whatsapp: "+27 83 000 0000", email: "hi@mzansi.test" });
  assert.equal(a.legalName, "Mzansi Eats (Pty) Ltd");
  assert.equal(a.tradingAs, "Mzansi Eats");
  assert.equal(a.registrationNumber, "2024/123456/07");
  assert.equal(a.complaintsContact, "+27 83 000 0000");
  assert.equal(a.usingTradingNameAsLegalName, false);
  // Same name in different case: no "trading as".
  const same = buildEctaInformation({ ...shop, settings: { legal: { legalName: "mzansi eats" } } });
  assert.equal(same.tradingAs, null);
  // Explicit complaints contact wins over every fallback.
  const explicit = buildEctaInformation({ ...filled, whatsapp: "+27 83 000 0000", settings: { legal: { ...filled.settings.legal, complaintsContact: "complaints@mzansi.test" } } });
  assert.equal(explicit.complaintsContact, "complaints@mzansi.test");
  // Email-only shop with no address: no address line, complaints via email.
  const bare = buildEctaInformation({ ...shop, phone: null, email: "hi@mzansi.test", address: null, suburb: null, city: null, province: null, postalCode: null });
  assert.equal(bare.addressLine, null);
  assert.equal(bare.complaintsContact, "hi@mzansi.test");
});
