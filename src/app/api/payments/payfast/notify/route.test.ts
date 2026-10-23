import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { POST } from "./route";
import { saveConnection, getConnection, markConnectionVerified, disconnect } from "@/modules/payments/payment-connection.service";
import { cancelOrder, recordInPersonPayment, completeOrder } from "@/modules/orders/order.service";
import { decideHandoff } from "@/modules/payments/pay-handoff";
import { createAttempt, markAttemptSubmitted, reconcileUnconfirmedAttempts } from "@/modules/payments/payment-attempt.service";

/**
 * The notification route, exercised as the route — not as the services under
 * it — because the ordering of its checks is itself the security property.
 *
 * Only PayFast's network postback is stubbed. Signatures are computed exactly
 * as PayFast computes them, so a test that passes here would pass against the
 * real gateway for the same payload.
 *
 * A full sandbox run additionally needs a publicly reachable notify_url,
 * which localhost cannot provide; that step is blocked on a deployment.
 */

const SUFFIX = Date.now();
let bizA = "";
let bizB = "";
let merchantA = "";
let merchantB = "";

const PASSPHRASE_A = "passphrase-for-a";
const PASSPHRASE_B = "passphrase-for-b";

/** Swapped in per test; the route's postback call resolves through this. */
let postbackReply = "VALID";
/** Simulates PayFast's check-back failing: a network error, or an error page. */
let postbackFailure: null | "network" | "http500" = null;
/** Every postback URL the route called, in order. */
const postbackUrls: string[] = [];
/** Extra businesses created by individual tests, cleaned up with A and B. */
const extraBusinesses: string[] = [];
const realFetch = globalThis.fetch;

async function makeBusiness(label: string): Promise<string> {
  const b = await prisma.business.create({
    data: {
      name: `ITN ${label}`,
      slug: `itn-${label}-${SUFFIX}`,
      category: "FOOD_VENDOR",
      status: "ACTIVE",
    },
    select: { id: true },
  });
  return b.id;
}

async function connect(businessId: string, merchantId: string, passphrase: string) {
  await saveConnection(businessId, {
    environment: "LIVE",
    merchantId,
    merchantKey: "46f0cd694581a",
    passphrase,
  });
  const view = await getConnection(businessId, "LIVE");
  await markConnectionVerified(view!.id, "bootstrap");
}

async function makeOrder(businessId: string, label: string, total = "130.00") {
  return prisma.order.create({
    data: { businessId, orderNumber: `ITN-${label}-${SUFFIX}`, subtotal: total, total },
    select: { id: true },
  });
}

/** Exactly PayFast's ITN rule: every posted field bar signature, in order, empties included. */
function sign(fields: [string, string][], passphrase: string): string {
  const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, "+");
  const parts = fields.map(([k, v]) => `${k}=${enc(v)}`);
  parts.push(`passphrase=${enc(passphrase)}`);
  return crypto.createHash("md5").update(parts.join("&")).digest("hex");
}

function itn(
  over: { reference: string; merchantId: string; amount?: string; status?: string; pfId?: string },
  passphrase: string,
  options: { corruptSignature?: boolean } = {},
): string {
  const fields: [string, string][] = [
    ["m_payment_id", over.reference],
    ["pf_payment_id", over.pfId ?? `pf-${Math.random().toString(36).slice(2, 10)}`],
    ["payment_status", over.status ?? "COMPLETE"],
    ["item_name", "Order"],
    ["amount_gross", over.amount ?? "130.00"],
    ["amount_fee", "-5.98"],
    ["amount_net", "124.02"],
    ["custom_str1", ""],
    ["merchant_id", over.merchantId],
  ];
  const signature = options.corruptSignature ? "0".repeat(32) : sign(fields, passphrase);
  return new URLSearchParams([...fields, ["signature", signature]]).toString();
}

async function post(body: string) {
  const req = new NextRequest("https://shop.example/api/payments/payfast/notify", {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  const res = await POST(req);
  const json = (await res.json()) as { ok: boolean; reason?: string; ignored?: string; retry?: boolean };
  lastStatus = res.status;
  return json;
}
/** HTTP status of the most recent post() — 200 is a verdict, anything else asks PayFast to retry. */
let lastStatus = 0;

test.before(async () => {
  merchantA = `9100${SUFFIX}`.slice(0, 12);
  merchantB = `9200${SUFFIX}`.slice(0, 12);
  bizA = await makeBusiness("a");
  bizB = await makeBusiness("b");
  await connect(bizA, merchantA, PASSPHRASE_A);
  await connect(bizB, merchantB, PASSPHRASE_B);

  // PayFast's postback, stubbed. Everything else is real.
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes("payfast.co.za")) {
      postbackUrls.push(String(url));
      if (postbackFailure === "network") throw new TypeError("fetch failed");
      if (postbackFailure === "http500") return new Response("<html>error</html>", { status: 500 });
      return new Response(postbackReply, { status: 200 });
    }
    return realFetch(url as never);
  }) as typeof fetch;
});

test.after(async () => {
  globalThis.fetch = realFetch;
  for (const id of [bizA, bizB, ...extraBusinesses]) {
    await prisma.businessPaymentEvent.deleteMany({ where: { businessId: id } });
    await prisma.businessNotification.deleteMany({ where: { businessId: id } });
    await prisma.businessPaymentAttempt.deleteMany({ where: { businessId: id } });
    await prisma.order.deleteMany({ where: { businessId: id } });
    await prisma.businessPaymentConnection.deleteMany({ where: { businessId: id } });
    await prisma.business.deleteMany({ where: { id } });
  }
});

async function openAttempt(businessId: string, label: string, total = "130.00") {
  const order = await makeOrder(businessId, label, total);
  const attempt = await createAttempt(businessId, "LIVE", {
    orderId: order.id,
    amount: Number(total),
  });
  await markAttemptSubmitted(attempt.id);
  return { order, attempt };
}

async function attemptRow(id: string) {
  return prisma.businessPaymentAttempt.findUniqueOrThrow({
    where: { id },
    select: { status: true, providerPaymentId: true, failureReason: true },
  });
}

async function refundNotices(businessId: string, providerPaymentId: string) {
  const rows = await prisma.businessNotification.findMany({ where: { businessId, type: "PAYMENT_REFUND_DUE" }, select: { message: true } });
  return rows.filter((r) => r.message.includes(providerPaymentId)).length;
}

async function paymentStatusOf(orderId: string) {
  const row = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { paymentStatus: true, paymentRef: true },
  });
  return row;
}

// --- the happy path ---------------------------------------------------------

test("a genuine notification settles the order exactly once", async () => {
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "happy");

  const body = itn({ reference: attempt.reference, merchantId: merchantA, pfId: `pf-happy-1-${SUFFIX}` }, PASSPHRASE_A);
  assert.deepEqual(await post(body), { ok: true });

  const paid = await paymentStatusOf(order.id);
  assert.equal(paid.paymentStatus, "PAID");
  assert.equal(paid.paymentRef, `pf-happy-1-${SUFFIX}`);
});

test("a duplicate notification is safe and does not settle twice", async () => {
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "dupe");
  const body = itn({ reference: attempt.reference, merchantId: merchantA, pfId: `pf-dupe-1-${SUFFIX}` }, PASSPHRASE_A);

  assert.deepEqual(await post(body), { ok: true });
  const second = await post(body);
  assert.equal(second.ok, true, "a retry is a success, not an error");
  assert.match(second.reason ?? "", /already processed/);

  assert.equal((await paymentStatusOf(order.id)).paymentRef, `pf-dupe-1-${SUFFIX}`);
});

// --- the rejections ---------------------------------------------------------

test("an unknown reference is refused", async () => {
  const res = await post(itn({ reference: "skh_does_not_exist", merchantId: merchantA }, PASSPHRASE_A));
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /unknown reference/);
});

test("a notification naming a different merchant is refused", async () => {
  // The check that stops one merchant's credentials settling another's order.
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "wrongmerchant");

  const res = await post(itn({ reference: attempt.reference, merchantId: merchantB }, PASSPHRASE_A));
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /merchant mismatch/);
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PENDING");
});

test("a notification signed with another merchant's passphrase is refused", async () => {
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "wrongpass");

  // Correct merchant id, but signed by B — the signature layer catches it.
  const res = await post(itn({ reference: attempt.reference, merchantId: merchantA }, PASSPHRASE_B));
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /bad signature/);
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PENDING");
});

test("a corrupted signature is refused", async () => {
  postbackReply = "VALID";
  const { attempt } = await openAttempt(bizA, "badsig");
  const res = await post(
    itn({ reference: attempt.reference, merchantId: merchantA }, PASSPHRASE_A, { corruptSignature: true }),
  );
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /bad signature/);
});

test("a payment PayFast does not confirm is refused — the postback fails closed", async () => {
  postbackReply = "INVALID";
  const { order, attempt } = await openAttempt(bizA, "notvalidated");

  const res = await post(itn({ reference: attempt.reference, merchantId: merchantA }, PASSPHRASE_A));
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /not validated/);
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PENDING");
  postbackReply = "VALID";
});

test("a verified payment of the wrong amount never pays the order — it is refund-due", async () => {
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "wrongamount");

  const res = await post(
    itn({ reference: attempt.reference, merchantId: merchantA, amount: "13.00", pfId: `pf-wrongamount-${SUFFIX}` }, PASSPHRASE_A),
  );
  assert.equal(res.ok, true, "understood — retrying changes nothing");
  assert.match(res.reason ?? "", /refund due/);
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PENDING");
  assert.equal((await attemptRow(attempt.id)).status, "REFUND_DUE");
});

test("a notification with no amount at all is refused, not waved through", async () => {
  // The old code skipped the amount check entirely when the field was absent,
  // which marked the order paid for any amount.
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "noamount");

  const fields: [string, string][] = [
    ["m_payment_id", attempt.reference],
    ["pf_payment_id", `pf-noamount-${SUFFIX}`],
    ["payment_status", "COMPLETE"],
    ["merchant_id", merchantA],
  ];
  const body = new URLSearchParams([...fields, ["signature", sign(fields, PASSPHRASE_A)]]).toString();

  const res = await post(body);
  assert.match(res.reason ?? "", /refund due/, "an unverifiable amount is never treated as paid");
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PENDING");
});

// --- non-successful outcomes ------------------------------------------------

test("a FAILED notification closes the attempt and leaves the order unpaid", async () => {
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "failed");

  const res = await post(
    itn({ reference: attempt.reference, merchantId: merchantA, status: "FAILED" }, PASSPHRASE_A),
  );
  assert.equal(res.ok, true);
  assert.equal(res.ignored, "FAILED");

  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PENDING");
  const row = await prisma.businessPaymentAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
    select: { status: true },
  });
  assert.equal(row.status, "FAILED");
});

test("an order can be retried after a failed attempt and then settles", async () => {
  postbackReply = "VALID";
  const { order, attempt: first } = await openAttempt(bizA, "retry");
  await post(itn({ reference: first.reference, merchantId: merchantA, status: "FAILED" }, PASSPHRASE_A));

  // The customer tries again — a fresh attempt, a fresh reference.
  const second = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 130 });
  await markAttemptSubmitted(second.id);
  assert.notEqual(second.reference, first.reference);

  const res = await post(
    itn({ reference: second.reference, merchantId: merchantA, pfId: `pf-retry-ok-${SUFFIX}` }, PASSPHRASE_A),
  );
  assert.equal(res.ok, true);
  assert.equal((await paymentStatusOf(order.id)).paymentRef, `pf-retry-ok-${SUFFIX}`);
});

test("a late notification for the abandoned attempt cannot settle it a second time", async () => {
  postbackReply = "VALID";
  const { order, attempt: abandoned } = await openAttempt(bizA, "late");
  const real = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 130 });
  await markAttemptSubmitted(real.id);

  await post(itn({ reference: real.reference, merchantId: merchantA, pfId: `pf-late-real-${SUFFIX}` }, PASSPHRASE_A));

  // ...and the abandoned one's notification finally turns up.
  const res = await post(
    itn({ reference: abandoned.reference, merchantId: merchantA, pfId: `pf-late-stale-${SUFFIX}` }, PASSPHRASE_A),
  );

  // This is a real second payment, not a duplicate notification — so it is
  // answered distinctly, and 200 so the gateway stops retrying something we
  // have understood.
  assert.equal(res.ok, true);
  assert.match(res.reason ?? "", /refund due/);

  const paid = await paymentStatusOf(order.id);
  assert.equal(paid.paymentRef, `pf-late-real-${SUFFIX}`, "the real payment's reference stands");
  assert.equal(paid.paymentStatus, "PAID");

  // The second charge is recorded, with its provider reference, flagged for a
  // human — never silently dropped.
  const flagged = await attemptRow(abandoned.id);
  assert.equal(flagged.status, "REFUND_DUE");
  assert.equal(flagged.providerPaymentId, `pf-late-stale-${SUFFIX}`);
  assert.match(flagged.failureReason ?? "", /already paid/i);
  // ...and the merchant is told, in their dashboard.
  assert.equal(await refundNotices(bizA, `pf-late-stale-${SUFFIX}`), 1);
});

// --- cross-tenant -----------------------------------------------------------

test("business A's notification cannot settle business B's order", async () => {
  postbackReply = "VALID";
  const { order: orderB } = await openAttempt(bizB, "victim");
  const { attempt: attemptA } = await openAttempt(bizA, "attacker");

  // A perfectly valid notification for A. It must touch nothing of B's.
  await post(itn({ reference: attemptA.reference, merchantId: merchantA, pfId: `pf-cross-${SUFFIX}` }, PASSPHRASE_A));

  const untouched = await paymentStatusOf(orderB.id);
  assert.equal(untouched.paymentStatus, "PENDING");
  assert.equal(untouched.paymentRef, null);
});

test("holding one merchant's credentials does not let you settle another's order", async () => {
  // The whole threat model in one test: B's passphrase, B's merchant id,
  // aimed at A's attempt reference.
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "forged");

  const res = await post(itn({ reference: attempt.reference, merchantId: merchantB }, PASSPHRASE_B));
  assert.equal(res.ok, false);
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PENDING");
});

// --- money that can't be applied -------------------------------------------

test("a resubmitted form that pays the SAME reference twice: first applies, second is refund-due", async () => {
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "samref");

  assert.deepEqual(await post(itn({ reference: attempt.reference, merchantId: merchantA, pfId: `pf-samref-1-${SUFFIX}` }, PASSPHRASE_A)), { ok: true });
  const second = await post(itn({ reference: attempt.reference, merchantId: merchantA, pfId: `pf-samref-2-${SUFFIX}` }, PASSPHRASE_A));
  assert.match(second.reason ?? "", /refund due/);

  assert.equal((await paymentStatusOf(order.id)).paymentRef, `pf-samref-1-${SUFFIX}`);
  const events = await prisma.businessPaymentEvent.findMany({ where: { attemptId: attempt.id }, orderBy: { receivedAt: "asc" }, select: { outcome: true, providerPaymentId: true } });
  assert.deepEqual(events, [
    { outcome: "SETTLED", providerPaymentId: `pf-samref-1-${SUFFIX}` },
    { outcome: "REFUND_DUE", providerPaymentId: `pf-samref-2-${SUFFIX}` },
  ]);
  assert.equal(await refundNotices(bizA, `pf-samref-2-${SUFFIX}`), 1);
});

test("a gateway retry records nothing new in the event trail", async () => {
  postbackReply = "VALID";
  const { attempt } = await openAttempt(bizA, "retrylog");
  const body = itn({ reference: attempt.reference, merchantId: merchantA, pfId: `pf-retrylog-${SUFFIX}` }, PASSPHRASE_A);
  await post(body);
  await post(body);
  await post(body);
  assert.equal(await prisma.businessPaymentEvent.count({ where: { attemptId: attempt.id } }), 1);
});

test("an unverified notification writes nothing at all", async () => {
  postbackReply = "VALID";
  const { attempt } = await openAttempt(bizA, "nowrite");
  await post(itn({ reference: attempt.reference, merchantId: merchantA }, PASSPHRASE_A, { corruptSignature: true }));
  postbackReply = "INVALID";
  await post(itn({ reference: attempt.reference, merchantId: merchantA }, PASSPHRASE_A));
  postbackReply = "VALID";
  assert.equal(await prisma.businessPaymentEvent.count({ where: { attemptId: attempt.id } }), 0);
  assert.equal((await attemptRow(attempt.id)).status, "SUBMITTED");
});

test("an attempt in a currency PayFast doesn't settle is refused", async () => {
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "currency");
  await prisma.businessPaymentAttempt.update({ where: { id: attempt.id }, data: { currency: "USD" } });
  const res = await post(itn({ reference: attempt.reference, merchantId: merchantA }, PASSPHRASE_A));
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /currency mismatch/);
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PENDING");
});

// --- order state stays separate from payment state --------------------------

test("cancelling an order closes its open attempts; a payment that still arrives is refund-due", async () => {
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "cancel");
  await cancelOrder(bizA, order.id, { reason: "CUSTOMER_ASKED", detail: null });
  assert.equal((await attemptRow(attempt.id)).status, "CANCELLED");

  const res = await post(itn({ reference: attempt.reference, merchantId: merchantA, pfId: `pf-cancel-${SUFFIX}` }, PASSPHRASE_A));
  assert.match(res.reason ?? "", /refund due/);
  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, paymentStatus: true } });
  assert.deepEqual(after, { status: "CANCELLED", paymentStatus: "PENDING" }, "a late payment never revives a cancelled order");
  assert.equal(await refundNotices(bizA, `pf-cancel-${SUFFIX}`), 1);
});

test("pay-in-person is its own path: it closes open attempts, and a later online payment is refund-due", async () => {
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "inperson");
  await recordInPersonPayment(bizA, order.id, "CASH");
  assert.equal((await attemptRow(attempt.id)).status, "CANCELLED");

  const res = await post(itn({ reference: attempt.reference, merchantId: merchantA, pfId: `pf-inperson-${SUFFIX}` }, PASSPHRASE_A));
  assert.match(res.reason ?? "", /refund due/);
  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentStatus: true, paymentMethod: true, paymentRef: true } });
  assert.deepEqual(after, { paymentStatus: "PAID", paymentMethod: "CASH", paymentRef: null });
});

test("completing fulfilment never marks an online order paid", async () => {
  const { order } = await openAttempt(bizA, "fulfilled");
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  await completeOrder(bizA, order.id);
  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, paymentStatus: true } });
  assert.deepEqual(after, { status: "COMPLETED", paymentStatus: "PENDING" });
  // ...and a completed order can't be sent to PayFast any more.
  assert.equal(decideHandoff({ paymentStatus: "PENDING", orderStatus: "COMPLETED", receivingVerified: true, openAttempts: 0, trustedOriginConfigured: true }).kind, "NOT_PAYABLE");
});

// --- connection lifecycle ---------------------------------------------------

test("disconnect: an in-flight payment still verifies and settles; no new attempt can start", async () => {
  postbackReply = "VALID";
  const biz = await makeBusiness("disconnect");
  extraBusinesses.push(biz);
  const merchant = `9300${SUFFIX}`.slice(0, 12);
  await connect(biz, merchant, "disconnect-pass");
  const { order, attempt } = await openAttempt(biz, "disconnect");

  await disconnect(biz, "LIVE");

  const res = await post(itn({ reference: attempt.reference, merchantId: merchant, pfId: `pf-disconnect-${SUFFIX}` }, "disconnect-pass"));
  assert.deepEqual(res, { ok: true });
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PAID");
  await assert.rejects(createAttempt(biz, "LIVE", { orderId: order.id, amount: 130 }), /no payment account connected/);
});

test("rotation: in-flight payments verify against the OLD credentials, and only those", async () => {
  postbackReply = "VALID";
  const biz = await makeBusiness("rotate-itn");
  extraBusinesses.push(biz);
  const oldMerchant = `9400${SUFFIX}`.slice(0, 12);
  await connect(biz, oldMerchant, "old-pass");
  const { order, attempt } = await openAttempt(biz, "rotate-itn");

  await saveConnection(biz, { environment: "LIVE", merchantId: `9500${SUFFIX}`.slice(0, 12), merchantKey: "46f0cd694581b", passphrase: "new-pass" });

  const withNew = await post(itn({ reference: attempt.reference, merchantId: oldMerchant }, "new-pass"));
  assert.match(withNew.reason ?? "", /bad signature/, "the new passphrase can't sign for a payment submitted under the old one");

  const withOld = await post(itn({ reference: attempt.reference, merchantId: oldMerchant, pfId: `pf-rotate-itn-${SUFFIX}` }, "old-pass"));
  assert.deepEqual(withOld, { ok: true });
  assert.equal((await paymentStatusOf(order.id)).paymentRef, `pf-rotate-itn-${SUFFIX}`);
});

test("sandbox and live are separate: each attempt is validated against its own PayFast host", async () => {
  postbackReply = "VALID";
  postbackUrls.length = 0;
  const { attempt: live } = await openAttempt(bizA, "envlive");
  await post(itn({ reference: live.reference, merchantId: merchantA }, PASSPHRASE_A));
  assert.ok(postbackUrls.at(-1)?.startsWith("https://www.payfast.co.za/"), "a live attempt asks the live host");

  const biz = await makeBusiness("sandbox");
  extraBusinesses.push(biz);
  const sandboxMerchant = `10000${SUFFIX}`.slice(0, 12);
  await saveConnection(biz, { environment: "SANDBOX", merchantId: sandboxMerchant, merchantKey: "46f0cd694581c", passphrase: "sandbox-pass" });
  const verification = await createAttempt(biz, "SANDBOX", { orderId: null, amount: 5, purpose: "LIVE_VERIFICATION" });
  await markAttemptSubmitted(verification.id);

  // Live credentials can't speak for a sandbox attempt...
  const crossed = await post(itn({ reference: verification.reference, merchantId: sandboxMerchant, amount: "5.00" }, PASSPHRASE_A));
  assert.match(crossed.reason ?? "", /bad signature/);

  // ...and the sandbox attempt is validated on the sandbox host.
  const res = await post(itn({ reference: verification.reference, merchantId: sandboxMerchant, amount: "5.00", pfId: `pf-sandbox-${SUFFIX}` }, "sandbox-pass"));
  assert.equal(res.ok, true);
  assert.ok(postbackUrls.at(-1)?.startsWith("https://sandbox.payfast.co.za/"), "a sandbox attempt asks the sandbox host");
  const conn = await getConnection(biz, "SANDBOX");
  assert.equal(conn?.status, "VERIFIED");
});

test("a verification payment that lands after a rotation never resurrects the retired connection", async () => {
  postbackReply = "VALID";
  const biz = await makeBusiness("verify-late");
  extraBusinesses.push(biz);
  const merchant = `11000${SUFFIX}`.slice(0, 12);
  await saveConnection(biz, { environment: "SANDBOX", merchantId: merchant, merchantKey: "46f0cd694581d", passphrase: "vl-pass" });
  const verification = await createAttempt(biz, "SANDBOX", { orderId: null, amount: 5, purpose: "LIVE_VERIFICATION" });
  await markAttemptSubmitted(verification.id);
  const retiredId = verification.credentials.merchantId;

  await saveConnection(biz, { environment: "SANDBOX", merchantId: `12000${SUFFIX}`.slice(0, 12), merchantKey: "46f0cd694581e", passphrase: "vl-new" });

  const res = await post(itn({ reference: verification.reference, merchantId: merchant, amount: "5.00", pfId: `pf-verify-late-${SUFFIX}` }, "vl-pass"));
  assert.equal((res as { verified?: boolean }).verified, false);
  const retired = await prisma.businessPaymentConnection.findFirstOrThrow({ where: { businessId: biz, merchantId: retiredId }, select: { status: true } });
  assert.equal(retired.status, "SUPERSEDED");
});

// --- B7: a notification we couldn't finish is a retry, never a silent drop ---

test("PayFast's check-back unreachable → 503 (PayFast retries), nothing recorded; the retry settles", async () => {
  postbackReply = "VALID";
  const { order, attempt } = await openAttempt(bizA, "pf-down");
  const body = itn({ reference: attempt.reference, merchantId: merchantA, pfId: `pf-down-${SUFFIX}` }, PASSPHRASE_A);

  for (const failure of ["network", "http500"] as const) {
    postbackFailure = failure;
    const res = await post(body);
    assert.equal(lastStatus, 503, failure);
    assert.equal(res.ok, false);
    assert.equal(res.retry, true);
  }
  postbackFailure = null;
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PENDING");
  assert.equal(await prisma.businessPaymentEvent.count({ where: { attemptId: attempt.id } }), 0, "no verdict was recorded");

  assert.deepEqual(await post(body), { ok: true });
  assert.equal(lastStatus, 200);
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PAID");
});

test("PayFast answering INVALID is still a final refusal (200), not a retry", async () => {
  postbackReply = "INVALID";
  const { attempt } = await openAttempt(bizA, "pf-invalid");
  const res = await post(itn({ reference: attempt.reference, merchantId: merchantA }, PASSPHRASE_A));
  assert.equal(lastStatus, 200);
  assert.equal(res.ok, false);
  postbackReply = "VALID";
});

test("an internal failure before the payment is recorded → 500 (retry); once fixed, the retry settles once", async () => {
  postbackReply = "VALID";
  const biz = await makeBusiness("db-fail");
  extraBusinesses.push(biz);
  const merchant = `13000${SUFFIX}`.slice(0, 12);
  await connect(biz, merchant, "dbfail-pass");
  const { order, attempt } = await openAttempt(biz, "db-fail");
  const connection = await prisma.businessPaymentConnection.findFirstOrThrow({ where: { businessId: biz, retiredAt: null } });

  // Break this connection's sealed passphrase: loading credentials throws.
  await prisma.businessPaymentConnection.update({ where: { id: connection.id }, data: { passphraseCipher: "v1:corrupt" } });
  const body = itn({ reference: attempt.reference, merchantId: merchant, pfId: `pf-dbfail-${SUFFIX}` }, "dbfail-pass");
  const failed = await post(body);
  assert.equal(lastStatus, 500);
  assert.equal(failed.retry, true);
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PENDING");

  await prisma.businessPaymentConnection.update({ where: { id: connection.id }, data: { passphraseCipher: connection.passphraseCipher } });
  assert.deepEqual(await post(body), { ok: true });
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PAID");
  // And PayFast's next retry is a harmless duplicate.
  const again = await post(body);
  assert.equal(lastStatus, 200);
  assert.match(again.reason ?? "", /already processed/);
});

test("a verification payment whose promotion failed is promoted by PayFast's retry", async () => {
  postbackReply = "VALID";
  const biz = await makeBusiness("verify-retry");
  extraBusinesses.push(biz);
  const merchant = `14000${SUFFIX}`.slice(0, 12);
  await saveConnection(biz, { environment: "SANDBOX", merchantId: merchant, merchantKey: "46f0cd694581f", passphrase: "vr-pass" });
  const verification = await createAttempt(biz, "SANDBOX", { orderId: null, amount: 5, purpose: "LIVE_VERIFICATION" });
  await markAttemptSubmitted(verification.id);
  const body = itn({ reference: verification.reference, merchantId: merchant, amount: "5.00", pfId: `pf-verify-retry-${SUFFIX}` }, "vr-pass");

  assert.equal((await post(body) as { verified?: boolean }).verified, true);
  // Simulate the first run having failed right after settling, before promoting.
  const conn = await prisma.businessPaymentConnection.findFirstOrThrow({ where: { businessId: biz, retiredAt: null } });
  await prisma.businessPaymentConnection.update({ where: { id: conn.id }, data: { status: "PENDING_VERIFICATION", verifiedAt: null } });

  assert.equal((await post(body) as { verified?: boolean }).verified, true);
  assert.equal((await prisma.businessPaymentConnection.findUniqueOrThrow({ where: { id: conn.id } })).status, "VERIFIED");
});

test("reconciliation: an unconfirmed payment is expired and the merchant told once; a late notification still settles", async () => {
  postbackReply = "VALID";
  const biz = await makeBusiness("reconcile");
  extraBusinesses.push(biz);
  const merchant = `15000${SUFFIX}`.slice(0, 12);
  await connect(biz, merchant, "reconcile-passphrase");
  const { order, attempt } = await openAttempt(biz, "reconcile");
  // Sent to PayFast three hours ago, never heard back.
  await prisma.businessPaymentAttempt.update({ where: { id: attempt.id }, data: { submittedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } });

  const result = await reconcileUnconfirmedAttempts();
  assert.ok(result.expired >= 1);
  assert.equal((await attemptRow(attempt.id)).status, "EXPIRED");
  const notices = await prisma.businessNotification.findMany({ where: { businessId: biz, type: "PAYMENT_UNCONFIRMED" } });
  assert.equal(notices.length, 1);
  assert.match(notices[0].message, new RegExp(attempt.reference));

  // Running again doesn't nag twice.
  await reconcileUnconfirmedAttempts();
  assert.equal(await prisma.businessNotification.count({ where: { businessId: biz, type: "PAYMENT_UNCONFIRMED" } }), 1);

  // The customer had paid after all: PayFast's late notification is applied.
  assert.deepEqual(await post(itn({ reference: attempt.reference, merchantId: merchant, pfId: `pf-late-rc-${SUFFIX}` }, "reconcile-passphrase")), { ok: true });
  assert.equal((await paymentStatusOf(order.id)).paymentStatus, "PAID");
});

test("reconciliation leaves fresh and already-paid attempts alone", async () => {
  postbackReply = "VALID";
  const { attempt: fresh } = await openAttempt(bizA, "rc-fresh");
  const { attempt: paid } = await openAttempt(bizA, "rc-paid");
  await post(itn({ reference: paid.reference, merchantId: merchantA, pfId: `pf-rc-paid-${SUFFIX}` }, PASSPHRASE_A));
  await prisma.businessPaymentAttempt.update({ where: { id: paid.id }, data: { submittedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } });

  await reconcileUnconfirmedAttempts();
  assert.equal((await attemptRow(fresh.id)).status, "SUBMITTED");
  assert.equal((await attemptRow(paid.id)).status, "COMPLETE");
});
