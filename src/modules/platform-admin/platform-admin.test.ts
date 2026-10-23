import test from "node:test";
import assert from "node:assert/strict";
import { redact } from "@/lib/redact";
import { ADMIN_PERMISSIONS, can, ROLE_PERMISSIONS } from "./permissions";
import { evaluateAlerts, THRESHOLDS } from "./alerts";
import { stripAdminPrefix } from "@/lib/tenant/admin-paths";

// --- redaction (logs + audit metadata) ---------------------------------------

test("redaction drops every secret-bearing key, masks long digit runs, and caps size", () => {
  const out = redact({
    password: "hunter2",
    newPassword: "x",
    otp: "123456",
    mfaCode: "654321",
    recoveryCode: "abcde-fghij",
    token: "t",
    trackingToken: "tt",
    customerKey: "ck",
    cookie: "c",
    authorization: "Bearer x",
    apiKey: "k",
    RESEND_API_KEY: "re_x",
    signature: "sig",
    nonce: "n",
    payoutAccountCipher: "v1.x",
    accountNumber: "1234567890",
    dropoffCode: "000111",
    pickupCode: "222333",
    code: "999999",
    reason: "Driver called — account 62012345678 confirmed",
    nested: { secret: "s", ok: "fine" },
    count: 3,
  }) as Record<string, unknown>;
  for (const k of ["password", "newPassword", "otp", "mfaCode", "recoveryCode", "token", "trackingToken", "customerKey", "cookie", "authorization", "apiKey", "RESEND_API_KEY", "signature", "nonce", "payoutAccountCipher", "accountNumber", "dropoffCode", "pickupCode", "code"]) {
    assert.equal(k in out, false, `${k} must be dropped`);
  }
  assert.equal(out.reason, "Driver called — account …5678 confirmed", "long digit runs keep only the last 4");
  assert.deepEqual(out.nested, { ok: "fine" });
  assert.equal(out.count, 3);
  assert.equal((redact({ long: "x".repeat(1000) }) as { long: string }).long.length <= 301, true);
});

// --- permission matrix -------------------------------------------------------

test("super admins hold every permission; every role can see the overview and health", () => {
  for (const p of ADMIN_PERMISSIONS) assert.ok(can("SUPER_ADMIN", p), p);
  for (const role of ["OPERATIONS", "FINANCE", "SUPPORT"] as const) {
    assert.ok(can(role, "overview") && can(role, "health"), role);
  }
});

test("least privilege: sensitive permissions are not part of ordinary roles", () => {
  // Audit/security logs and admin management: super admins only.
  for (const role of ["OPERATIONS", "FINANCE", "SUPPORT"] as const) {
    for (const p of ["audit.view", "security.view", "admins.manage"] as const) assert.equal(can(role, p), false, `${role} ${p}`);
  }
  // Driver documents need more than viewing drivers.
  assert.equal(can("SUPPORT", "drivers.view"), true);
  assert.equal(can("SUPPORT", "drivers.documents"), false);
  assert.equal(can("FINANCE", "drivers.documents"), false);
  assert.equal(can("OPERATIONS", "drivers.documents"), true);
  // Tab 5: erasing a business is super-only; handling data-subject requests is operations and super.
  for (const role of ["OPERATIONS", "FINANCE", "SUPPORT"] as const) assert.equal(can(role, "businesses.erase"), false, `${role} businesses.erase`);
  assert.equal(can("OPERATIONS", "privacy.manage"), true);
  assert.equal(can("FINANCE", "privacy.manage"), false);
  assert.equal(can("SUPPORT", "privacy.manage"), false);
  // Money moves only with payouts.manage (finance/super), never operations or support.
  assert.equal(can("OPERATIONS", "payouts.manage"), false);
  assert.equal(can("SUPPORT", "payouts.manage"), false);
  assert.equal(can("FINANCE", "payouts.manage"), true);
  // Customer addresses/phones: not for support or finance.
  assert.equal(can("SUPPORT", "orders.customerDetails"), false);
  assert.equal(can("FINANCE", "orders.customerDetails"), false);
  // Support is read-only.
  for (const p of ["businesses.manage", "drivers.manage", "deliveries.intervene", "ai.manage"] as const) assert.equal(can("SUPPORT", p), false, p);
  assert.equal(ROLE_PERMISSIONS.SUPPORT.size < ROLE_PERMISSIONS.OPERATIONS.size, true);
});

// --- alert rules ----------------------------------------------------------------

function base() {
  return {
    db: { up: true, ms: 120 as number | null },
    lastDailyRun: new Date(),
    config: { email: true, cronSecret: true, paymentsEncryptionKey: true, livePaymentVerification: true, platformBilling: false, externalAi: false, skhokholetha: { network: true, driverSignup: false, deliveryRequests: true, driverApprovals: true, legalConfigured: true } },
    commerce: { ordersToday: 5, completedToday: 3, cancelledToday: 0, awaitingMerchant: 1, gmvTodayCents: 10000, averageOrderCents: 2000, paymentsLast24h: { succeeded: 20, failed: 1, refundDue: 0, pending: 0, successRate: 20 / 21 as number | null } },
    delivery: { drivers: { pending: 0, approved: 3, suspended: 0, online: 2, busy: 1 }, deliveries: { active: 1, searching: 0, late: 0, searchingTooLong: 0, failedLast7d: 0, disputed: 0 }, latency: { medianSecondsToFirstOffer: 5, medianSecondsToAssignment: 60, samples: 4 } },
    security: { last24h: {} as Record<string, number>, adminActionsLast24h: 0 },
    system: { emailFailures: 0, notificationFailures: 0, jobFailures: 0, dispatchFailures: 0, paymentProcessingFailures: 0, paymentConnectionsLive: 1, webhookRejections: 0 },
  };
}
const keys = (x: ReturnType<typeof evaluateAlerts>) => x.map((a) => `${a.severity}:${a.key}`);

test("alerts: a healthy platform raises nothing", () => {
  assert.deepEqual(evaluateAlerts(base()), []);
});

test("alerts: critical conditions are CRITICAL and sorted first", () => {
  const i = base();
  i.db = { up: false, ms: null };
  i.commerce.paymentsLast24h = { succeeded: 0, failed: 12, refundDue: 0, pending: 0, successRate: 0 };
  i.delivery.deliveries.searchingTooLong = 2;
  i.delivery.drivers.online = 0;
  i.security.last24h = { admin_mfa_failed: THRESHOLDS.adminMfaFailures24h };
  i.system.jobFailures = 2;
  const k = keys(evaluateAlerts(i));
  for (const c of ["CRITICAL:db_down", "CRITICAL:payments_broken", "CRITICAL:dispatch_down", "CRITICAL:admin_auth_attack", "HIGH:job_failures"]) assert.ok(k.includes(c), c);
  assert.equal(k[0].startsWith("CRITICAL"), true);
  assert.equal(k[k.length - 1].startsWith("CRITICAL"), false);
});

test("alerts: high and medium thresholds", () => {
  const i = base();
  i.commerce.paymentsLast24h = { succeeded: 6, failed: 4, refundDue: 0, pending: 0, successRate: 0.6 };
  i.lastDailyRun = new Date(Date.now() - 30 * 3600_000);
  i.config.email = false;
  i.delivery.latency.medianSecondsToAssignment = 900;
  i.delivery.deliveries.late = 1;
  i.security.last24h = { delivery_code_locked: 3, rate_limit_triggered: 60 };
  const k = keys(evaluateAlerts(i));
  for (const c of ["HIGH:payment_failure_spike", "HIGH:cron_stale", "HIGH:email_unconfigured", "HIGH:dispatch_latency", "MEDIUM:late_deliveries", "MEDIUM:otp_failures", "MEDIUM:rate_limits"]) assert.ok(k.includes(c), c);
});

test("alerts: dispatch-down needs the network switched on", () => {
  const i = base();
  i.delivery.deliveries.searchingTooLong = 1;
  i.delivery.drivers.online = 0;
  i.config.skhokholetha.network = false;
  assert.equal(keys(evaluateAlerts(i)).includes("CRITICAL:dispatch_down"), false);
});

test("admin paths: prefix stripped once", () => {
  assert.equal(stripAdminPrefix("/platform-admin/audit"), "/audit");
});
