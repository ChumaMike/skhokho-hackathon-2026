import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, nextStatuses, transitionFor, InvalidTransitionError, TRANSITIONS, TERMINAL_STATUSES } from "./state-machine";
import { codeMatches, deriveCode, deriveTrackingToken, hashTrackingToken, newCodeNonce } from "./codes";
import { haversineMeters, isValidLatLng, NETWORK_PRICING, quoteNetworkDelivery } from "./pricing";
import { applicationReadiness, operatingEligibility, requiredDocuments, safeFileName } from "./driver.service";
import type { DriverLegalConfig } from "./legal";
import { safeEventData } from "./events";

// --- state machine -------------------------------------------------------------

test("the happy path is a chain of allowed transitions", () => {
  const path: [Parameters<typeof transitionFor>[0], Parameters<typeof transitionFor>[1], Parameters<typeof transitionFor>[2]][] = [
    ["START_SEARCH", "CREATED", "SYSTEM"],
    ["OFFERS_SENT", "SEARCHING", "SYSTEM"],
    ["ACCEPT", "OFFERED", "DRIVER"],
    ["HEAD_TO_PICKUP", "ASSIGNED", "DRIVER"],
    ["ARRIVE_PICKUP", "DRIVER_TO_PICKUP", "DRIVER"],
    ["CONFIRM_PICKUP", "ARRIVED_PICKUP", "DRIVER"],
    ["START_TRANSIT", "PICKED_UP", "DRIVER"],
    ["ARRIVE_DROPOFF", "IN_TRANSIT", "DRIVER"],
    ["CONFIRM_DELIVERY", "ARRIVED_DROPOFF", "DRIVER"],
  ];
  for (const [action, from, actor] of path) assert.ok(canTransition(action, from, actor), `${action} from ${from}`);
});

test("impossible transitions are rejected (e.g. DELIVERED → PICKED_UP, skipping steps)", () => {
  assert.throws(() => transitionFor("CONFIRM_PICKUP", "DELIVERED", "DRIVER"), InvalidTransitionError);
  assert.throws(() => transitionFor("CONFIRM_DELIVERY", "PICKED_UP", "DRIVER"), InvalidTransitionError, "can't skip arriving");
  assert.throws(() => transitionFor("CONFIRM_DELIVERY", "ASSIGNED", "DRIVER"), InvalidTransitionError);
  assert.throws(() => transitionFor("ACCEPT", "ASSIGNED", "DRIVER"), InvalidTransitionError, "can't accept a taken delivery");
  assert.throws(() => transitionFor("CANCEL", "PICKED_UP", "SHOP"), InvalidTransitionError, "no cancelling after pickup");
});

test("terminal statuses have no way out", () => {
  for (const s of TERMINAL_STATUSES) assert.deepEqual(nextStatuses(s).filter((t) => t !== "DISPUTED"), [], s);
  assert.deepEqual(nextStatuses("CANCELLED"), []);
  assert.deepEqual(nextStatuses("RETURNED"), []);
});

test("each action is limited to its actors", () => {
  assert.equal(canTransition("CONFIRM_DELIVERY", "ARRIVED_DROPOFF", "SHOP"), false, "a shop can't mark delivered");
  assert.equal(canTransition("ACCEPT", "OFFERED", "SHOP"), false);
  assert.equal(canTransition("DISPUTE", "DELIVERED", "DRIVER"), false);
  assert.equal(canTransition("CANCEL", "SEARCHING", "DRIVER"), false, "drivers decline offers, they don't cancel deliveries");
  assert.ok(canTransition("CANCEL", "SEARCHING", "SHOP"));
  assert.ok(canTransition("DISPUTE", "DELIVERED", "ADMIN"));
});

test("pickup and delivery require codes; cancel/fail require a reason", () => {
  assert.equal(TRANSITIONS.CONFIRM_PICKUP.requires, "PICKUP_CODE");
  assert.equal(TRANSITIONS.CONFIRM_DELIVERY.requires, "DROPOFF_CODE");
  assert.equal(TRANSITIONS.CANCEL.requires, "REASON");
  assert.equal(TRANSITIONS.FAIL.requires, "REASON");
  assert.equal(TRANSITIONS.CONFIRM_DELIVERY.assignedDriverOnly, true);
});

// --- codes ---------------------------------------------------------------------

test("codes are 6 digits, deterministic per nonce, and differ by purpose and delivery", () => {
  const nonce = newCodeNonce();
  const a = deriveCode("PICKUP", "nd_1", nonce);
  assert.match(a, /^\d{6}$/);
  assert.equal(deriveCode("PICKUP", "nd_1", nonce), a);
  assert.notEqual(deriveCode("DROPOFF", "nd_1", nonce), a);
  assert.notEqual(deriveCode("PICKUP", "nd_2", nonce), a);
});

test("a new nonce invalidates the old code", () => {
  const n1 = newCodeNonce();
  const n2 = newCodeNonce();
  const code = deriveCode("DROPOFF", "nd_x", n1);
  assert.ok(codeMatches("DROPOFF", "nd_x", n1, code));
  assert.equal(codeMatches("DROPOFF", "nd_x", n2, code), false);
});

test("code matching rejects junk and tolerates spaces", () => {
  const n = newCodeNonce();
  const code = deriveCode("PICKUP", "nd_y", n);
  assert.ok(codeMatches("PICKUP", "nd_y", n, `${code.slice(0, 3)} ${code.slice(3)}`));
  for (const bad of ["", "12345", "1234567", "abcdef", "000000' OR 1=1"]) assert.equal(codeMatches("PICKUP", "nd_y", n, bad), false, bad);
});

test("tracking tokens are long, unguessable and only their hash is a lookup key", () => {
  const t = deriveTrackingToken("nd_z", newCodeNonce());
  assert.ok(t.length >= 40);
  assert.notEqual(hashTrackingToken(t), t);
  assert.equal(hashTrackingToken(t).length, 64);
});

// --- pricing -------------------------------------------------------------------

const SOWETO = { lat: -26.2485, lng: 27.854 };
const NEARBY = { lat: -26.26, lng: 27.87 };

test("pricing: the network cost is the customer's exact fee, never below the network minimum; parity fields add up", () => {
  const SOWETO = { lat: -26.2485, lng: 27.854 };
  const NEARBY = { lat: -26.26, lng: 27.87 };
  const r = quoteNetworkDelivery({ deliveryEnabled: true, customerFeeCents: 3500, pickup: SOWETO, dropoff: NEARBY });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.quote.quoteFeeCents, 3500);
  assert.equal(r.quote.customerFeeCents, 3500);
  assert.equal(r.quote.merchantCostCents, 0);
  assert.equal(r.quote.driverEarningCents + r.quote.platformFeeCents, r.quote.quoteFeeCents);
  const low = quoteNetworkDelivery({ deliveryEnabled: true, customerFeeCents: 1500, pickup: SOWETO, dropoff: NEARBY });
  assert.ok(low.ok && low.quote.quoteFeeCents === NETWORK_PRICING.minimumFeeCents);
  assert.ok(low.ok && low.quote.merchantCostCents === NETWORK_PRICING.minimumFeeCents - 1500, "the shop covers the shortfall, explicitly");
  const a = quoteNetworkDelivery({ deliveryEnabled: true, customerFeeCents: 2000, pickup: SOWETO, dropoff: NEARBY });
  const b = quoteNetworkDelivery({ deliveryEnabled: true, customerFeeCents: 2000, pickup: SOWETO, dropoff: NEARBY });
  assert.deepEqual(a, b, "deterministic");
});

test("pricing refuses: delivery off, too far, missing/invalid coordinates, missing customer fee", () => {
  const SOWETO = { lat: -26.2485, lng: 27.854 };
  const NEARBY = { lat: -26.26, lng: 27.87 };
  const on = { deliveryEnabled: true, customerFeeCents: 3000 };
  assert.equal(quoteNetworkDelivery({ ...on, deliveryEnabled: false, pickup: SOWETO, dropoff: NEARBY }).ok, false);
  assert.equal(quoteNetworkDelivery({ ...on, pickup: SOWETO, dropoff: { lat: -33.92, lng: 18.42 } }).ok, false, "Cape Town is out of radius");
  assert.equal(quoteNetworkDelivery({ ...on, pickup: { lat: 0, lng: 0 }, dropoff: NEARBY }).ok, false);
  assert.equal(quoteNetworkDelivery({ ...on, pickup: SOWETO, dropoff: { lat: Number.NaN, lng: 1 } }).ok, false);
  assert.equal(quoteNetworkDelivery({ ...on, customerFeeCents: -1, pickup: SOWETO, dropoff: NEARBY }).ok, false);
  assert.equal(isValidLatLng({ lat: 91, lng: 0 }), false);
});

test("haversine is sane", () => {
  const d = haversineMeters(SOWETO, NEARBY);
  assert.ok(d > 1500 && d < 2500, String(d));
});

// --- driver eligibility -----------------------------------------------------------

const now = new Date("2026-10-07T10:00:00Z");
const doc = (kind: "ID_DOCUMENT" | "DRIVERS_LICENCE" | "VEHICLE_REGISTRATION", status: "PENDING" | "ACCEPTED" | "REJECTED" = "ACCEPTED", expiresOn: Date | null = null) => ({
  kind,
  status,
  expiresOn,
  uploadedAt: new Date("2026-10-01T00:00:00Z"),
});
const car = [{ type: "CAR" as const, isActive: true }];
const allDocs = [doc("ID_DOCUMENT"), doc("DRIVERS_LICENCE"), doc("VEHICLE_REGISTRATION")];

test("required documents depend on the vehicle (bicycle: ID only)", () => {
  assert.deepEqual(requiredDocuments("BICYCLE"), ["ID_DOCUMENT"]);
  assert.deepEqual(requiredDocuments("CAR"), ["ID_DOCUMENT", "DRIVERS_LICENCE", "VEHICLE_REGISTRATION"]);
});

const LEGAL: DriverLegalConfig = {
  ok: true,
  terms: { kind: "TERMS", version: "t-1", url: "https://example.test/terms" },
  privacy: { kind: "PRIVACY", version: "p-1", url: "https://example.test/privacy" },
};
const accepted = { agreementVersion: "t-1", agreementAcceptedAt: now, privacyVersion: "p-1", privacyAcceptedAt: now };

test("only an APPROVED driver with valid documents, a vehicle, location consent and current legal acceptance may operate", () => {
  const approved = { verificationStatus: "APPROVED" as "APPROVED" | "DRAFT" | "PENDING_REVIEW" | "REJECTED" | "SUSPENDED", locationConsentAt: now as Date | null, ...accepted };
  const ok = (p: typeof approved, v = car, d = allDocs, l: DriverLegalConfig = LEGAL) => operatingEligibility(p, v, d, now, l).eligible;
  assert.ok(ok(approved));
  for (const status of ["DRAFT", "PENDING_REVIEW", "REJECTED", "SUSPENDED"] as const) {
    assert.equal(ok({ ...approved, verificationStatus: status }), false, status);
  }
  assert.equal(ok(approved, []), false, "no vehicle");
  assert.equal(ok({ ...approved, locationConsentAt: null } as never), false, "no consent");
  assert.equal(ok(approved, car, [doc("ID_DOCUMENT"), doc("DRIVERS_LICENCE", "PENDING"), doc("VEHICLE_REGISTRATION")]), false, "unverified licence");
  assert.equal(ok(approved, car, [doc("ID_DOCUMENT"), doc("DRIVERS_LICENCE", "ACCEPTED", new Date("2026-09-30")), doc("VEHICLE_REGISTRATION")]), false, "expired licence");
  // Legal: a newer published version, or no published documents at all, stops work.
  assert.equal(ok(approved, car, allDocs, { ...LEGAL, terms: { ...LEGAL.terms, version: "t-2" } } as DriverLegalConfig), false, "terms updated");
  assert.equal(ok(approved, car, allDocs, { ok: false, missing: ["DRIVER_TERMS_VERSION"] }), false, "legal not configured");
  assert.equal(ok({ ...approved, privacyAcceptedAt: null } as never), false, "privacy not accepted");
});

test("an application can't be submitted until everything is there", () => {
  const profile = { displayName: "Thabo M", phone: "+27821234567", payoutAccountCipher: "sealed", ...accepted };
  const pending = [doc("ID_DOCUMENT", "PENDING"), doc("DRIVERS_LICENCE", "PENDING"), doc("VEHICLE_REGISTRATION", "PENDING")];
  const r = (p: typeof profile, email = true, docs = pending, l: DriverLegalConfig = LEGAL) => applicationReadiness(p, email, car, docs, l);
  assert.ok(r(profile).ready);
  assert.ok(r(profile, false).missing.includes("Confirm your email address"));
  assert.ok(r({ ...profile, payoutAccountCipher: null } as never).missing.some((m) => /payout/.test(m)));
  assert.ok(r({ ...profile, agreementVersion: "old" }).missing.some((m) => /terms/.test(m)));
  assert.ok(r(profile, true, [doc("ID_DOCUMENT", "PENDING")]).missing.some((m) => /licence/.test(m)));
  // No published legal documents → can never be ready, whatever the driver did.
  assert.ok(r(profile, true, pending, { ok: false, missing: ["DRIVER_TERMS_VERSION"] }).missing.some((m) => /not published/.test(m)));
});

test("uploaded file names can't carry paths or odd characters", () => {
  assert.equal(safeFileName("../../etc/passwd", "application/pdf"), "passwd.pdf");
  assert.equal(safeFileName("C:\\Users\\me\\id<script>.png", "image/png"), "idscript.png");
  assert.equal(safeFileName("", "image/jpeg"), "document.jpg");
});

test("delivery events never carry codes, tokens or bank details", () => {
  assert.deepEqual(safeEventData({ pickupCode: "123456", trackingToken: "x", accountNumber: "1", nonce: "n", reason: "flat tyre" }), { reason: "flat tyre" });
});
