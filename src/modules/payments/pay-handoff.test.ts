import test from "node:test";
import assert from "node:assert/strict";
import { decideHandoff, buyerContactForHandoff } from "./pay-handoff";
import { MAX_OPEN_ATTEMPTS_PER_ORDER } from "./payment-attempt.service";

const READY = {
  paymentStatus: "PENDING",
  orderStatus: "PENDING",
  receivingVerified: true,
  openAttempts: 0,
  trustedOriginConfigured: true,
};

test("a pending, live order with a verified account is handed off", () => {
  assert.equal(decideHandoff(READY).kind, "HANDOFF");
});

test("an already-paid order is never sent to PayFast again", () => {
  assert.equal(decideHandoff({ ...READY, paymentStatus: "PAID" }).kind, "ALREADY_PAID");
});

test("cancelled, completed or refunded orders can't be paid online", () => {
  for (const orderStatus of ["CANCELLED", "COMPLETED", "REFUNDED"]) {
    assert.equal(decideHandoff({ ...READY, orderStatus }).kind, "NOT_PAYABLE", orderStatus);
  }
  for (const paymentStatus of ["REFUNDED", "FAILED", "PARTIAL"]) {
    assert.equal(decideHandoff({ ...READY, paymentStatus }).kind, "NOT_PAYABLE", paymentStatus);
  }
});

test("no verified merchant account → no online payment (never a platform fallback)", () => {
  assert.equal(decideHandoff({ ...READY, receivingVerified: false }).kind, "ONLINE_PAYMENT_OFF");
});

test("production without NEXT_PUBLIC_APP_URL refuses rather than trusting the Host header", () => {
  assert.equal(decideHandoff({ ...READY, trustedOriginConfigured: false }).kind, "MISCONFIGURED");
});

test("a reload loop can't open unlimited handoffs", () => {
  assert.equal(decideHandoff({ ...READY, openAttempts: MAX_OPEN_ATTEMPTS_PER_ORDER - 1 }).kind, "HANDOFF");
  assert.equal(decideHandoff({ ...READY, openAttempts: MAX_OPEN_ATTEMPTS_PER_ORDER }).kind, "TOO_MANY_ATTEMPTS");
});

test("only one buyer contact is put in the handoff form — email first", () => {
  assert.deepEqual(
    buyerContactForHandoff([{ type: "phone", value: "+27821234567" }, { type: "email", value: "a@b.co.za" }]),
    { buyerEmail: "a@b.co.za" },
  );
  assert.deepEqual(buyerContactForHandoff([{ type: "phone", value: "+27821234567" }]), { buyerCellNumber: "+27821234567" });
  assert.deepEqual(buyerContactForHandoff([]), {});
});
