import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { __setEmailTransportForTests } from "@/lib/email";
import {
  acceptOrder,
  cancelOrder,
  createOrder,
  customerCancellationText,
  getOrderCancellation,
  getOrderEta,
  parseCancellation,
  ACCEPT_ETA_MINUTES,
} from "./order.service";

/**
 * Accept with ETA (distinct from Confirm) and the fixed cancellation reason
 * list: what is stored on the order, what the customer is told, and what is
 * refused.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const created: string[] = [];
const sent: { to: string; subject: string; text?: string }[] = [];

async function business(label: string) {
  const b = await prisma.business.create({ data: { name: `Accept Cancel ${label}`, slug: `accept-${label}-${run}`, status: "ACTIVE" }, select: { id: true } });
  created.push(b.id);
  await prisma.product.create({ data: { businessId: b.id, name: "Kota", price: 45, trackStock: false } });
  return b.id;
}

async function order(businessId: string, notifyEmail?: string) {
  const product = await prisma.product.findFirstOrThrow({ where: { businessId }, select: { id: true } });
  const o = await createOrder(businessId, {
    source: "online",
    items: [{ productId: product.id, name: "Kota", quantity: 1, unitPrice: 45, discount: 0 }],
    discount: 0,
    paymentStatus: "PENDING",
    fulfilmentMethod: "COLLECTION",
    deliveryFee: 0,
    notifyEmail,
  });
  return o!.id;
}

/** The status email is fire-and-forget after the write (a round trip to Neon) — wait for it rather than guess a delay. */
async function waitForMail(match: (m: { to: string; subject: string }) => boolean, timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const found = sent.find(match);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 200));
  }
  return undefined;
}

test.before(() => {
  __setEmailTransportForTests(async (msg) => {
    sent.push({ to: msg.to, subject: msg.subject, text: msg.text });
    return { id: `msg-${sent.length}` };
  });
});

test.after(async () => {
  __setEmailTransportForTests(null);
  await prisma.orderItem.deleteMany({ where: { order: { businessId: { in: created } } } });
  await prisma.order.deleteMany({ where: { businessId: { in: created } } });
  await prisma.product.deleteMany({ where: { businessId: { in: created } } });
  await prisma.businessNotification.deleteMany({ where: { businessId: { in: created } } });
  await prisma.business.deleteMany({ where: { id: { in: created } } });
});

test("accepting with an ETA confirms the order once, stores the promise, and tells the customer the time", async () => {
  const b = await business("eta");
  const id = await order(b, `eta-${run}@example.test`);
  const now = new Date("2026-10-21T10:00:00Z"); // 12:00 SAST

  await assert.rejects(acceptOrder(b, id, 7 as never), /offered times/);
  const accepted = await acceptOrder(b, id, 20, now);
  assert.equal(accepted.status, "CONFIRMED");
  const eta = getOrderEta(accepted.metadata);
  assert.deepEqual(eta, { minutes: 20, readyAt: "2026-10-21T10:20:00.000Z" });
  assert.ok((ACCEPT_ETA_MINUTES as readonly number[]).includes(eta!.minutes));

  // Not twice, and not from any other status.
  await assert.rejects(acceptOrder(b, id, 20), /Only a new order/);

  // The customer's confirmation carries the time, in South African time.
  const mail = await waitForMail((m) => m.to === `eta-${run}@example.test` && /confirmed/i.test(m.subject));
  assert.ok(mail, "confirmation email sent");
  assert.match(mail!.text ?? "", /ready to collect at about 12:20/);
});

test("cancelling needs a reason from the list; the record and the customer's sentence come from it", async () => {
  const b = await business("cancel");
  const id = await order(b, `cancel-${run}@example.test`);

  assert.throws(() => parseCancellation("MADE_UP", null), /Choose a reason/);
  assert.throws(() => parseCancellation("OTHER", "  "), /Say briefly why/);
  assert.deepEqual(parseCancellation("OUT_OF_STOCK", undefined), { reason: "OUT_OF_STOCK", detail: null });
  assert.equal(customerCancellationText({ reason: "OUT_OF_STOCK", detail: null }), "Something you ordered is out of stock.");
  assert.equal(customerCancellationText({ reason: "OTHER", detail: "Power is off in the street." }), "Power is off in the street.");

  await assert.rejects(cancelOrder(b, id, { reason: "NOPE" as never, detail: null }), /Choose a reason/);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id } })).status, "PENDING", "a refused reason cancels nothing");

  const cancelled = await cancelOrder(b, id, { reason: "COULD_NOT_REACH", detail: "Phone off since 11:00" }, "staff-1");
  assert.equal(cancelled.status, "CANCELLED");
  const record = getOrderCancellation(cancelled.metadata);
  assert.equal(record?.reason, "COULD_NOT_REACH");
  assert.equal(record?.detail, "Phone off since 11:00");
  assert.equal(record?.byStaffId, "staff-1");
  assert.match(cancelled.notes ?? "", /Couldn't reach the customer — Phone off since 11:00/);

  const mail = await waitForMail((m) => m.to === `cancel-${run}@example.test` && /cancelled/i.test(m.subject));
  assert.ok(mail);
  assert.match(mail!.text ?? "", /could not reach you to confirm\. Phone off since 11:00/);
});
