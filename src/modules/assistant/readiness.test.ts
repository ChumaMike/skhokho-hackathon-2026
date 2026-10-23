import test from "node:test";
import assert from "node:assert/strict";
import { computeReadiness, type ReadinessInput } from "./readiness";

const complete: ReadinessInput = {
  status: "ACTIVE",
  logoUrl: "https://example.test/logo.png",
  bannerUrl: "https://example.test/banner.png",
  phone: "0821234567",
  whatsapp: null,
  address: "1 Main Road",
  suburb: "Soweto",
  city: "Johannesburg",
  hasOperatingHours: true,
  activeProductCount: 3,
  productsWithPhoto: 3,
  deliveryEnabled: false,
  deliveryAreaInfo: null,
};

const keys = (items: { key: string }[]) => items.map((i) => i.key);

test("a fully set-up business has nothing to flag", () => {
  assert.deepEqual(computeReadiness(complete), []);
});

test("no menu items is a warning that points to the menu page", () => {
  const items = computeReadiness({ ...complete, activeProductCount: 0, productsWithPhoto: 0 });
  const item = items.find((i) => i.key === "NO_MENU_ITEMS");
  assert.ok(item);
  assert.equal(item.severity, "WARNING");
  assert.equal(item.href, "/dashboard/catalog");
});

test("menu items without photos are counted, not just flagged", () => {
  const items = computeReadiness({ ...complete, activeProductCount: 4, productsWithPhoto: 1 });
  const item = items.find((i) => i.key === "MENU_PHOTOS");
  assert.ok(item);
  assert.match(item.message, /3 of 4 menu items/);
});

test("a missing logo and banner are suggestions, not warnings", () => {
  const items = computeReadiness({ ...complete, logoUrl: null, bannerUrl: null });
  assert.deepEqual(keys(items), ["LOGO", "BANNER"]);
  assert.ok(items.every((i) => i.severity === "SUGGESTION"));
});

test("no opening hours and no contact number are warnings", () => {
  const items = computeReadiness({ ...complete, hasOperatingHours: false, phone: null, whatsapp: null });
  assert.deepEqual(keys(items), ["OPENING_HOURS", "CONTACT"]);
  assert.ok(items.every((i) => i.severity === "WARNING"));
});

test("WhatsApp alone satisfies the contact check", () => {
  const items = computeReadiness({ ...complete, phone: null, whatsapp: "0821234567" });
  assert.equal(items.some((i) => i.key === "CONTACT"), false);
});

test("delivery without an area description is flagged only when delivery is on", () => {
  assert.equal(computeReadiness({ ...complete, deliveryEnabled: false }).some((i) => i.key === "DELIVERY_AREA"), false);
  assert.equal(computeReadiness({ ...complete, deliveryEnabled: true }).some((i) => i.key === "DELIVERY_AREA"), true);
});

test("a draft with menu items is told to publish, and an empty draft is not", () => {
  assert.equal(computeReadiness({ ...complete, status: "PENDING_VERIFICATION" }).some((i) => i.key === "PUBLISH"), true);
  const empty = computeReadiness({ ...complete, status: "PENDING_VERIFICATION", activeProductCount: 0, productsWithPhoto: 0 });
  assert.equal(empty.some((i) => i.key === "PUBLISH"), false, "publishing an empty shop is not the next step");
});
