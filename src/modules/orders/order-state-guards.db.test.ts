import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createOrder, cancelOrder, completeOrder, advanceOrderStatus, recordInPersonPayment, completeDeliveredOrder, InvalidOrderTransitionError } from "./order.service";

/**
 * The guards are the WHERE clauses, not the pre-reads: each write is
 * conditional on the status it expects, so a change that lands between the
 * read and the write is refused rather than overwritten.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const created: string[] = [];

async function business(label: string) {
  const b = await prisma.business.create({ data: { name: `State Guard ${label}`, slug: `guard-${label}-${run}`, status: "ACTIVE" }, select: { id: true } });
  created.push(b.id);
  const product = await prisma.product.create({ data: { businessId: b.id, name: "Kota", price: 45, trackStock: false }, select: { id: true } });
  return { id: b.id, productId: product.id };
}

async function order(b: { id: string; productId: string }) {
  const o = await createOrder(b.id, {
    source: "pos",
    items: [{ productId: b.productId, name: "Kota", quantity: 1, unitPrice: 45, discount: 0 }],
    discount: 0,
    paymentStatus: "PENDING",
    fulfilmentMethod: "COLLECTION",
    deliveryFee: 0,
  });
  return o!.id;
}

const status = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id }, select: { status: true, paymentStatus: true } }));

test.after(async () => {
  await prisma.orderItem.deleteMany({ where: { order: { businessId: { in: created } } } });
  await prisma.order.deleteMany({ where: { businessId: { in: created } } });
  await prisma.product.deleteMany({ where: { businessId: { in: created } } });
  await prisma.businessNotification.deleteMany({ where: { businessId: { in: created } } });
  await prisma.business.deleteMany({ where: { id: { in: created } } });
});

test("a terminal order can't be cancelled, completed or advanced — by any path", async () => {
  const b = await business("terminal");
  const done = await order(b);
  await prisma.order.update({ where: { id: done }, data: { status: "COMPLETED" } });
  await assert.rejects(cancelOrder(b.id, done, { reason: "DUPLICATE", detail: null }), InvalidOrderTransitionError);
  await assert.rejects(advanceOrderStatus(b.id, done), InvalidOrderTransitionError);
  await assert.rejects(completeOrder(b.id, done), InvalidOrderTransitionError);

  const gone = await order(b);
  await cancelOrder(b.id, gone, { reason: "CUSTOMER_ASKED", detail: null });
  await assert.rejects(cancelOrder(b.id, gone, { reason: "CUSTOMER_ASKED", detail: null }), /already cancelled/);
  await assert.rejects(completeOrder(b.id, gone), InvalidOrderTransitionError);
  assert.equal((await status(gone)).status, "CANCELLED");
});

test("a delivery completing an order that was cancelled meanwhile does not revive it", async () => {
  const b = await business("delivered-late");
  const id = await order(b);
  const snapshot = await prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
  // The driver's tap read the order as READY; the shop cancelled it a moment later.
  await prisma.order.update({ where: { id }, data: { status: "CANCELLED" } });
  await prisma.$transaction((tx) => completeDeliveredOrder(tx, b.id, { ...snapshot, status: "READY" }));
  assert.equal((await status(id)).status, "CANCELLED", "the stale read did not win");
});

test("cash can't be recorded against a cancelled order, and a stale cancel is refused", async () => {
  const b = await business("cash");
  const id = await order(b);
  await cancelOrder(b.id, id, { reason: "OUT_OF_STOCK", detail: null });
  await assert.rejects(recordInPersonPayment(b.id, id, "CASH"), /already be paid or cancelled/);
  assert.equal((await status(id)).paymentStatus, "PENDING");

  // Two people cancel at once: the second write finds a different status than it read.
  const other = await order(b);
  const read = await prisma.order.findUniqueOrThrow({ where: { id: other }, select: { status: true } });
  assert.equal(read.status, "PENDING");
  await prisma.order.update({ where: { id: other }, data: { status: "CONFIRMED" } });
  // cancelOrder re-reads (CONFIRMED) and cancels from there — still a legal move.
  await cancelOrder(b.id, other, { reason: "CLOSED_OR_BUSY", detail: null });
  assert.equal((await status(other)).status, "CANCELLED");
});
