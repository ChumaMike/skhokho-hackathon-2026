import test from "node:test";
import assert from "node:assert/strict";
import { Secret, TOTP } from "otpauth";
import { prisma } from "@/lib/prisma/client";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { __setEmailTransportForTests, sendEmail } from "@/lib/email";
import { beginEnrollment, confirmEnrollment, ensurePlatformAdmin, hashRecoveryCode, MfaError, resetAdminMfa, verifySecondFactor, TOTP_PERIOD } from "./mfa.service";
import { recordAudit } from "./audit";
import { setAdminRole } from "./admins.service";
import { setBusinessStatus } from "./businesses.service";
import { runJob } from "./jobs";
import { addLedgerAdjustment, getDriverBalance } from "@/modules/skhokholetha/ledger.service";
import { businessMetrics, commerceMetrics, deliveryMetrics, securityMetrics, systemMetrics, databaseHealth } from "./metrics";

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const ip = () => `10.55.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function makeAdmin(label: string, role: "SUPER_ADMIN" | "OPERATIONS" | "FINANCE" | "SUPPORT" = "SUPPORT") {
  const email = `pa-${label}-${run}@example.test`;
  const user = await prisma.appUser.create({ data: { email, role: "ADMIN" }, select: { id: true } });
  const admin = await ensurePlatformAdmin(user.id);
  if (role !== "SUPPORT") await prisma.platformAdmin.update({ where: { id: admin.id }, data: { role } });
  return { userId: user.id, adminId: admin.id, email };
}

/** Enrol with the real flow, returning the secret (as the phone app would hold it) and the recovery codes. */
async function enrolled(label: string, role?: Parameters<typeof makeAdmin>[1]) {
  const a = await makeAdmin(label, role);
  const setup = await beginEnrollment(a.userId, a.email);
  const now = new Date();
  const code = new TOTP({ secret: Secret.fromBase32(setup.secret), period: TOTP_PERIOD }).generate({ timestamp: now.getTime() });
  const { recoveryCodes } = await confirmEnrollment(a.userId, a.email, code, { ip: ip() }, now);
  return { ...a, secret: setup.secret, recoveryCodes };
}

const codeAt = (secret: string, t: Date) => new TOTP({ secret: Secret.fromBase32(secret), period: TOTP_PERIOD }).generate({ timestamp: t.getTime() });

test.after(async () => {
  __setEmailTransportForTests(null);
  await prisma.appUser.deleteMany({ where: { email: { contains: run } } }).catch(() => undefined);
});

// --- MFA ----------------------------------------------------------------------

test("MFA enrolment: secret sealed at rest, recovery codes stored only as HMACs, audited", async () => {
  const a = await enrolled("enrol");
  const row = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: a.adminId }, include: { recoveryCodes: true } });
  assert.ok(row.mfaEnabledAt);
  assert.equal(row.mfaPendingCipher, null);
  assert.notEqual(row.mfaSecretCipher, a.secret, "secret is not stored in plaintext");
  assert.equal(decryptSecret(row.mfaSecretCipher!), a.secret);
  assert.equal(row.recoveryCodes.length, 10);
  for (const c of a.recoveryCodes) {
    assert.equal(JSON.stringify(row.recoveryCodes).includes(c), false, "no plaintext recovery code in the database");
    assert.ok(row.recoveryCodes.some((r) => r.codeHash === hashRecoveryCode(c)));
  }
  assert.ok(await prisma.platformAuditEvent.findFirst({ where: { action: "admin_mfa_enrolled", actorId: a.userId } }));
  await assert.rejects(beginEnrollment(a.userId, a.email), (e) => e instanceof MfaError && e.code === "ALREADY_ENROLLED");
});

test("MFA: no MFA set up → verify refused; enrolment needs a correct code", async () => {
  const a = await makeAdmin("nomfa");
  await assert.rejects(verifySecondFactor(a.userId, a.email, { code: "123456" }, { ip: ip() }), (e) => e instanceof MfaError && e.code === "NOT_ENROLLED");
  await beginEnrollment(a.userId, a.email);
  await assert.rejects(confirmEnrollment(a.userId, a.email, "000000", { ip: ip() }), (e) => e instanceof MfaError && e.code === "INVALID");
  assert.equal((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: a.adminId } })).mfaEnabledAt, null);
});

test("MFA verify: valid code passes; the same code (same time-step) can't be replayed; invalid code is audited without the code", async () => {
  const a = await enrolled("verify");
  const later = new Date(Date.now() + TOTP_PERIOD * 3 * 1000);
  const ok = await verifySecondFactor(a.userId, a.email, { code: codeAt(a.secret, later) }, { ip: ip() }, later);
  assert.equal(ok.usedRecoveryCode, false);
  await assert.rejects(verifySecondFactor(a.userId, a.email, { code: codeAt(a.secret, later) }, { ip: ip() }, later), /isn't right/, "replay refused");
  const wrong = codeAt(a.secret, later) === "111111" ? "222222" : "111111";
  await assert.rejects(verifySecondFactor(a.userId, a.email, { code: wrong }, { ip: ip() }, later), /isn't right/);
  const events = await prisma.platformAuditEvent.findMany({ where: { action: "admin_mfa_failed", actorId: a.userId } });
  assert.ok(events.length >= 2);
  assert.equal(JSON.stringify(events).includes(wrong), false, "the presented code is never stored");
});

test("MFA: recovery codes work once each", async () => {
  const a = await enrolled("recovery");
  const r = await verifySecondFactor(a.userId, a.email, { recoveryCode: a.recoveryCodes[0].toUpperCase() }, { ip: ip() });
  assert.equal(r.usedRecoveryCode, true);
  await assert.rejects(verifySecondFactor(a.userId, a.email, { recoveryCode: a.recoveryCodes[0] }, { ip: ip() }), /recovery code isn't valid/);
  assert.ok(await prisma.platformAuditEvent.findFirst({ where: { action: "admin_recovery_code_used", actorId: a.userId } }));
});

test("MFA rate limiting: after 5 attempts in 15 minutes the account is locked out (even with a right code) and it's audited", async () => {
  const a = await enrolled("ratelimit");
  for (let i = 0; i < 5; i++) await assert.rejects(verifySecondFactor(a.userId, a.email, { code: "000000" }, { ip: ip() }), MfaError);
  const now = new Date(Date.now() + TOTP_PERIOD * 5 * 1000);
  await assert.rejects(verifySecondFactor(a.userId, a.email, { code: codeAt(a.secret, now) }, { ip: ip() }, now), (e) => e instanceof MfaError && e.code === "RATE_LIMITED");
  assert.ok(await prisma.platformAuditEvent.findFirst({ where: { action: "admin_mfa_rate_limited", actorId: a.userId } }));
});

test("MFA reset: only another super admin, with a reason; clears the factor, ends sessions, audited", async () => {
  const target = await enrolled("reset-target", "OPERATIONS");
  const sup = await enrolled("reset-super", "SUPER_ADMIN");
  const ops = await enrolled("reset-ops", "OPERATIONS");
  const before = (await prisma.platformAdmin.findUniqueOrThrow({ where: { id: target.adminId } })).sessionEpoch;
  await assert.rejects(resetAdminMfa(ops.userId, target.adminId, "lost phone, verified", { ip: null }), /Only a super admin/);
  await assert.rejects(resetAdminMfa(sup.userId, sup.adminId, "my own phone", { ip: null }), /own MFA/);
  await assert.rejects(resetAdminMfa(sup.userId, target.adminId, "x", { ip: null }), /reason/);
  await resetAdminMfa(sup.userId, target.adminId, "Lost phone — verified by video call", { ip: null });
  const after = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: target.adminId }, include: { recoveryCodes: true } });
  assert.equal(after.mfaEnabledAt, null);
  assert.equal(after.mfaSecretCipher, null);
  assert.equal(after.recoveryCodes.length, 0);
  assert.equal(after.sessionEpoch, before + 1, "existing sessions are ended");
  const ev = await prisma.platformAuditEvent.findFirst({ where: { action: "admin_mfa_reset", resourceId: target.adminId } });
  assert.equal(ev?.actorId, sup.userId);
  assert.match(ev?.reason ?? "", /video call/);
});

// --- audit -----------------------------------------------------------------------

test("audit: metadata is redacted, IPs hashed, and the log is append-only", async () => {
  const marker = `audit-${run}`;
  await recordAudit({ category: "SECURITY", action: marker, actor: { type: "anonymous" }, ip: "196.25.1.1", metadata: { password: "p", otp: "123456", accountNumber: "62012345678", note: "acct 62012345678", ok: 1 } });
  const ev = await prisma.platformAuditEvent.findFirstOrThrow({ where: { action: marker } });
  assert.deepEqual(ev.metadata, { note: "acct …5678", ok: 1 });
  assert.ok(ev.ipHash && !ev.ipHash.includes("196.25"));
  await assert.rejects(prisma.platformAuditEvent.update({ where: { id: ev.id }, data: { action: "tampered" } }), /append-only/);
  await assert.rejects(prisma.platformAuditEvent.delete({ where: { id: ev.id } }), /append-only/);
});

test("audit: a non-UUID business id is dropped, never thrown; strict mode surfaces failures", async () => {
  await recordAudit({ category: "SYSTEM", action: `bad-biz-${run}`, actor: { type: "system" }, businessId: "not-a-uuid" });
  const ev = await prisma.platformAuditEvent.findFirstOrThrow({ where: { action: `bad-biz-${run}` } });
  assert.equal(ev.businessId, null);
  await assert.rejects(recordAudit({ category: "SYSTEM", action: "x".repeat(10), actor: { type: "system" }, resource: { type: "t", id: "y" } }, { strict: true, tx: { platformAuditEvent: { create: async () => { throw new Error("db down"); } } } as never }), /db down/);
});

// --- admin management, business commands, ledger adjustments -----------------------

test("admin roles: never your own, never the last super admin; a change ends the target's sessions", async () => {
  const sup = await makeAdmin("roles-super", "SUPER_ADMIN");
  const other = await makeAdmin("roles-other");
  await assert.rejects(setAdminRole(sup.userId, sup.adminId, "SUPPORT"), /own role/);
  const epoch = (await prisma.platformAdmin.findUniqueOrThrow({ where: { id: other.adminId } })).sessionEpoch;
  assert.deepEqual(await setAdminRole(sup.userId, other.adminId, "FINANCE"), { from: "SUPPORT", to: "FINANCE" });
  assert.equal((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: other.adminId } })).sessionEpoch, epoch + 1);
  // Demoting a super admin is refused while they're the only active one (deactivate the others for this check).
  const supers = await prisma.platformAdmin.findMany({ where: { role: "SUPER_ADMIN", NOT: { id: sup.adminId } }, select: { userId: true } });
  await prisma.appUser.updateMany({ where: { id: { in: supers.map((s) => s.userId) } }, data: { isActive: false } });
  try {
    await assert.rejects(setAdminRole(other.userId, sup.adminId, "SUPPORT"), /last super admin/);
  } finally {
    await prisma.appUser.updateMany({ where: { id: { in: supers.map((s) => s.userId) } }, data: { isActive: true } });
  }
});

test("business status: suspend/reactivate are conditional commands, not free edits", async () => {
  const b = await prisma.business.create({ data: { name: `PA Biz ${run}`, slug: `pa-biz-${run}`, status: "ACTIVE" }, select: { id: true } });
  try {
    assert.equal(await setBusinessStatus(b.id, "SUSPEND"), "SUSPENDED");
    await assert.rejects(setBusinessStatus(b.id, "SUSPEND"), /Only an active/);
    assert.equal(await setBusinessStatus(b.id, "REACTIVATE"), "ACTIVE");
  } finally {
    await prisma.business.delete({ where: { id: b.id } });
  }
});

test("ledger adjustments: a new entry with actor, reason and reference — idempotent, validated, never an edit", async () => {
  const user = await prisma.appUser.create({ data: { email: `pa-driver-${run}@example.test`, role: "DRIVER" }, select: { id: true } });
  const driver = await prisma.driverProfile.create({ data: { userId: user.id, displayName: "Adj Driver" }, select: { id: true } });
  const key = `adj-${run}-key`;
  await assert.rejects(addLedgerAdjustment("admin-x", driver.id, { amountCents: 1500, reason: "x", reference: "T-1", idempotencyKey: key }), /Explain/);
  await assert.rejects(addLedgerAdjustment("admin-x", driver.id, { amountCents: 1500, reason: "Missed earning", reference: "", idempotencyKey: key }), /reference/);
  await assert.rejects(addLedgerAdjustment("admin-x", driver.id, { amountCents: 1_000_000, reason: "Too big", reference: "T-1", idempotencyKey: key }), /R 5 000/);
  await assert.rejects(addLedgerAdjustment("admin-x", driver.id, { amountCents: 0, reason: "Zero", reference: "T-1", idempotencyKey: key }), /non-zero/);
  const [a, b] = await Promise.all([
    addLedgerAdjustment("admin-x", driver.id, { amountCents: 1500, reason: "Missed earning for order 12", reference: "TICKET-77", idempotencyKey: key }),
    addLedgerAdjustment("admin-x", driver.id, { amountCents: 1500, reason: "Missed earning for order 12", reference: "TICKET-77", idempotencyKey: key }),
  ].map((p) => p.catch((e) => e)));
  const rows = await prisma.driverLedgerEntry.findMany({ where: { driverId: driver.id } });
  assert.equal(rows.length, 1, `double submit adds once (${String(a)} / ${String(b)})`);
  assert.deepEqual([rows[0].createdBy, rows[0].reason, rows[0].reference, rows[0].amountCents], ["admin-x", "Missed earning for order 12", "TICKET-77", 1500]);
  assert.equal((await getDriverBalance(driver.id)).availableCents, 1500);
  await prisma.driverLedgerEntry.deleteMany({ where: { driverId: driver.id } });
  await prisma.driverProfile.delete({ where: { id: driver.id } });
});

// --- observability ---------------------------------------------------------------------

test("jobs: every run is recorded; a failure is a job_runs row + SYSTEM event, never a thrown error", async () => {
  const ok = await runJob(`test.ok.${run}`, async () => ({ processed: 3, token: "never-stored" }));
  assert.deepEqual(ok, { ok: true, result: { processed: 3, token: "never-stored" } });
  const okRow = await prisma.jobRun.findFirstOrThrow({ where: { job: `test.ok.${run}` } });
  assert.equal(okRow.ok, true);
  assert.deepEqual(okRow.summary, { processed: 3 }, "summaries are redacted");
  const bad = await runJob(`test.bad.${run}`, async () => {
    throw new Error("provider exploded");
  });
  assert.deepEqual(bad, { ok: false, error: "provider exploded" });
  assert.equal((await prisma.jobRun.findFirstOrThrow({ where: { job: `test.bad.${run}` } })).ok, false);
  assert.ok(await prisma.platformAuditEvent.findFirst({ where: { action: "job_failed", resourceId: `test.bad.${run}` } }));
});

test("email: a provider failure returns sent:false, is observable, and never records the recipient or body", async () => {
  const to = `customer-${run}@example.test`;
  __setEmailTransportForTests(async () => ({ id: null, errorName: "validation_error" }));
  const r = await sendEmail({ to, subject: `Secret subject ${run}`, html: "<a href='https://x/delivery/KEY123'>link</a>", kind: "customer_order_confirmation" });
  assert.deepEqual(r, { sent: false });
  __setEmailTransportForTests(async () => {
    throw new Error("network down");
  });
  assert.deepEqual(await sendEmail({ to, subject: "s", html: "h", kind: "driver_verify" }), { sent: false }, "never throws");
  __setEmailTransportForTests(async () => ({ id: "msg_1" }));
  assert.deepEqual(await sendEmail({ to, subject: "s", html: "h", kind: "password_reset" }), { sent: true });
  __setEmailTransportForTests(null);
  const events = await prisma.platformAuditEvent.findMany({ where: { action: "email_failed", createdAt: { gte: new Date(Date.now() - 60_000) } } });
  assert.ok(events.some((e) => JSON.stringify(e.metadata).includes("customer_order_confirmation")));
  const blob = JSON.stringify(events);
  assert.equal(blob.includes(to), false);
  assert.equal(blob.includes("KEY123"), false);
  assert.equal(blob.includes(`Secret subject ${run}`), false);
});

test("metrics: every dashboard query runs against the real schema", async () => {
  const [b, c, d, s, sys, db] = await Promise.all([businessMetrics(), commerceMetrics(), deliveryMetrics(), securityMetrics(), systemMetrics(), databaseHealth()]);
  assert.equal(typeof b.total, "number");
  assert.equal(typeof c.gmvTodayCents, "number");
  assert.equal(typeof d.deliveries.active, "number");
  assert.equal(typeof s.adminActionsLast24h, "number");
  assert.equal(typeof sys.jobFailures, "number");
  assert.equal(db.up, true);
});
