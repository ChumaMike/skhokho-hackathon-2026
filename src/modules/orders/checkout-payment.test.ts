import test from "node:test";
import assert from "node:assert/strict";
import { checkoutPaymentOptions, customerPaymentMode, resolveCheckoutPayment, type ReceivingConnection } from "./checkout-payment";

/**
 * The single decision point for "does this customer reach a card gateway".
 *
 * Under merchant-direct settlement it takes a VERIFIED LIVE connection
 * belonging to this business, plus the owner's consent. There is deliberately
 * no platform fallback left to test for — a business without its own verified
 * account has no online card option at all, because the alternative is
 * routing that merchant's customer money to SGDataInt.
 *
 * Getting this wrong is bad in both directions: a false positive sends
 * someone to a gateway that cannot take their money, a false negative quietly
 * stops a shop being paid online when it expected to be.
 */

const OFF = { settings: { payment: { online: false } } };
const ON = { settings: { payment: { online: true } } };
const UNSET = { settings: null };

const VERIFIED_LIVE: ReceivingConnection = { status: "VERIFIED", environment: "LIVE" };

// --- the only combination that takes a card ---------------------------------

test("a verified live connection plus owner consent is what takes a card", () => {
  assert.deepEqual(resolveCheckoutPayment(ON, "COLLECTION", VERIFIED_LIVE), { kind: "online" });
});

test("a business that never touched the setting still takes card once verified", () => {
  // The preference defaults to on, so it is the connection that gates here.
  assert.deepEqual(resolveCheckoutPayment(UNSET, "COLLECTION", VERIFIED_LIVE), { kind: "online" });
});

// --- everything else settles in person --------------------------------------

test("no connection at all means in person — never a platform fallback", () => {
  assert.equal(resolveCheckoutPayment(UNSET, "COLLECTION", undefined).kind, "in_person");
  assert.equal(resolveCheckoutPayment(UNSET, "COLLECTION", null).kind, "in_person");
});

test("saved but unverified credentials do not take a customer's money", () => {
  // Never treated as ready merely because the fields were filled in.
  const pending: ReceivingConnection = { status: "PENDING_VERIFICATION", environment: "LIVE" };
  assert.equal(resolveCheckoutPayment(ON, "COLLECTION", pending).kind, "in_person");
});

test("a verified SANDBOX connection never takes a real customer's money", () => {
  // Sandbox proves the wiring, but it is a test account — a real payment into
  // it would settle nowhere.
  const sandbox: ReceivingConnection = { status: "VERIFIED", environment: "SANDBOX" };
  assert.equal(resolveCheckoutPayment(ON, "COLLECTION", sandbox).kind, "in_person");
});

test("a disabled, invalid or superseded connection cannot receive", () => {
  for (const status of ["DISABLED", "INVALID", "SUPERSEDED"] as const) {
    assert.equal(
      resolveCheckoutPayment(ON, "COLLECTION", { status, environment: "LIVE" }).kind,
      "in_person",
      `${status} must not receive money`,
    );
  }
});

test("the owner can turn card payment off even with a verified connection", () => {
  assert.equal(resolveCheckoutPayment(OFF, "COLLECTION", VERIFIED_LIVE).kind, "in_person");
});

// --- what the customer is told ----------------------------------------------

test("the order is still placed, and marked CASH so the owner can reconcile it", () => {
  const result = resolveCheckoutPayment(UNSET, "COLLECTION");
  assert.equal(result.kind === "in_person" && result.method, "CASH");
});

test("what the customer is told depends on how they are receiving it", () => {
  const collection = resolveCheckoutPayment(UNSET, "COLLECTION");
  const delivery = resolveCheckoutPayment(UNSET, "DELIVERY");
  assert.ok(collection.kind === "in_person" && /collect/i.test(collection.customerMessage));
  assert.ok(delivery.kind === "in_person" && /driver/i.test(delivery.customerMessage));
});

// --- the customer's choice once card is live ---------------------------------

const BOTH = { settings: { payment: { online: true, inPerson: true } } };
const CARD_ONLY = { settings: { payment: { online: true, inPerson: false } } };

test("with card live and nothing restricted, the customer chooses — and card is the default", () => {
  assert.deepEqual(checkoutPaymentOptions(ON, VERIFIED_LIVE), { card: true, inPerson: true });
  assert.deepEqual(checkoutPaymentOptions(UNSET, VERIFIED_LIVE), { card: true, inPerson: true }, "a business that never touched inPerson still lets customers pay in person");
  assert.equal(resolveCheckoutPayment(BOTH, "COLLECTION", VERIFIED_LIVE, "CARD").kind, "online");
  assert.equal(resolveCheckoutPayment(BOTH, "COLLECTION", VERIFIED_LIVE).kind, "online", "no choice sent: behaves exactly as before");
  const cash = resolveCheckoutPayment(BOTH, "DELIVERY", VERIFIED_LIVE, "IN_PERSON");
  assert.ok(cash.kind === "in_person" && cash.method === "CASH" && /driver/i.test(cash.customerMessage));
});

test("the merchant can restrict to one way, and the server ignores a choice that isn't on offer", () => {
  assert.deepEqual(checkoutPaymentOptions(CARD_ONLY, VERIFIED_LIVE), { card: true, inPerson: false });
  assert.equal(resolveCheckoutPayment(CARD_ONLY, "COLLECTION", VERIFIED_LIVE, "IN_PERSON").kind, "online", "card only: a forged IN_PERSON still pays by card");
  assert.deepEqual(checkoutPaymentOptions(OFF, VERIFIED_LIVE), { card: false, inPerson: true });
  assert.equal(resolveCheckoutPayment(OFF, "COLLECTION", VERIFIED_LIVE, "CARD").kind, "in_person", "in person only: a forged CARD still settles in person");
});

test("without a live verified account there is nothing to choose: in person is always open", () => {
  assert.deepEqual(checkoutPaymentOptions(CARD_ONLY, null), { card: false, inPerson: true }, "'card only' cannot lock customers out while card isn't live");
  assert.deepEqual(checkoutPaymentOptions(CARD_ONLY, { status: "VERIFIED", environment: "SANDBOX" }), { card: false, inPerson: true });
  assert.equal(resolveCheckoutPayment(CARD_ONLY, "COLLECTION", null, "CARD").kind, "in_person");
});

test("the settings page's three modes round-trip from the stored booleans", () => {
  assert.equal(customerPaymentMode(UNSET), "CARD_OR_IN_PERSON");
  assert.equal(customerPaymentMode(BOTH), "CARD_OR_IN_PERSON");
  assert.equal(customerPaymentMode(CARD_ONLY), "CARD_ONLY");
  assert.equal(customerPaymentMode(OFF), "IN_PERSON_ONLY");
  assert.equal(customerPaymentMode({ settings: { payment: { online: false, inPerson: false } } }), "IN_PERSON_ONLY", "online off wins: nobody can be left with no way to pay");
});
