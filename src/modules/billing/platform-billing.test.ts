import test from "node:test";
import assert from "node:assert/strict";
import {
  vatMode,
  splitInclusive,
  invoiceDocumentTitle,
  vatRateLabel,
  invoiceIssuingEnabled,
} from "./vat";
import { formatInvoiceNumber, addOneMonth, periodFrom, platformReference, PAYMENT_TERMS_DAYS } from "./invoice.service";
import { noticeStageFor, graceEndFor, trialPeriod, TRIAL_DAYS } from "./lifecycle.service";
import { limitMessage, ENFORCED_LIMITS } from "./limits";
import { SUBSCRIPTION_GRACE_DAYS, subscriptionAccess } from "./entitlements";
import { MANAGED_SERVICES, managedService } from "./managed-services";
import { platformPaymentMode, platformCredentials } from "@/lib/payfast";

/**
 * Pure-logic tests for platform billing — Skhokho Laboratory billing a
 * merchant. No database, so these run in any tab at any time (coordination
 * rules: unit tests any time, the shared TEST database only by announcement).
 *
 * Everything covered here is a decision the billing layer makes on its own:
 * the VAT mode, the invoice number format, the billing anniversary, the
 * dunning state machine, the trial and grace clocks, and the separation
 * between this flow and a merchant's own customer payments.
 */

/** Runs `fn` with env vars set, restoring them afterwards whatever happens. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const key of Object.keys(vars)) {
    saved.set(key, process.env[key]);
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (n: number) => new Date(Date.UTC(2026, 10, 17, 9, 0, 0) + n * DAY_MS);

// --- VAT: two modes, neither assumed ---------------------------------------

test("not VAT registered: no VAT line, and the document is not a Tax Invoice", () => {
  withEnv({ BILLING_VAT_NUMBER: undefined }, () => {
    const mode = vatMode();
    assert.equal(mode.registered, false);
    assert.equal(invoiceDocumentTitle(mode), "Invoice");
    assert.equal(vatRateLabel(mode), null);
    const split = splitInclusive(59900, mode);
    assert.deepEqual(split, { totalCents: 59900, subtotalCents: 59900, vatCents: 0 });
  });
});

test("the Tax Invoice label and the VAT number come from the same switch, so one cannot appear without the other", () => {
  withEnv({ BILLING_VAT_NUMBER: undefined }, () => {
    assert.equal(invoiceDocumentTitle(vatMode()), "Invoice");
  });
  withEnv({ BILLING_VAT_NUMBER: "4123456789", BILLING_VAT_RATE_BP: undefined }, () => {
    const mode = vatMode();
    assert.equal(mode.registered, true);
    if (!mode.registered) return;
    assert.equal(mode.vatNumber, "4123456789");
    assert.equal(invoiceDocumentTitle(mode), "Tax Invoice");
  });
});

test("VAT registered: prices are inclusive, so the merchant pays the advertised figure", () => {
  withEnv({ BILLING_VAT_NUMBER: "4123456789", BILLING_VAT_RATE_BP: undefined }, () => {
    const mode = vatMode();
    // GROW at R599.00 inclusive: VAT = 599 * 15/115 = R78.13
    const grow = splitInclusive(59900, mode);
    assert.equal(grow.totalCents, 59900, "the advertised price is what they pay");
    assert.equal(grow.vatCents, 7813);
    assert.equal(grow.subtotalCents, 52087);
    assert.equal(grow.subtotalCents + grow.vatCents, grow.totalCents, "the parts always sum to the total");

    // PRO at R1299.00 inclusive.
    const pro = splitInclusive(129900, mode);
    assert.equal(pro.subtotalCents + pro.vatCents, 129900);
    assert.equal(vatRateLabel(mode), "15%");
  });
});

test("a nonsense VAT rate falls back to 15% rather than producing nonsense tax", () => {
  for (const bad of ["0", "-1", "99999", "abc", "15.5"]) {
    withEnv({ BILLING_VAT_NUMBER: "4123456789", BILLING_VAT_RATE_BP: bad }, () => {
      const mode = vatMode();
      assert.equal(mode.registered && mode.rateBasisPoints, 1500, `rate ${bad}`);
    });
  }
});

test("issuing real invoices stays blocked until the tax status is explicitly confirmed", () => {
  withEnv({ BILLING_TAX_STATUS_CONFIRMED: undefined }, () => {
    assert.equal(invoiceIssuingEnabled(), false);
  });
  withEnv({ BILLING_TAX_STATUS_CONFIRMED: "false" }, () => {
    assert.equal(invoiceIssuingEnabled(), false);
  });
  withEnv({ BILLING_TAX_STATUS_CONFIRMED: "true" }, () => {
    assert.equal(invoiceIssuingEnabled(), true);
  });
});

// --- Invoice numbering ------------------------------------------------------

test("invoice numbers are SKHL-INV-YYYY-NNNNNN, zero padded to six digits", () => {
  assert.equal(formatInvoiceNumber(2026, 1), "SKHL-INV-2026-000001");
  assert.equal(formatInvoiceNumber(2026, 42), "SKHL-INV-2026-000042");
  assert.equal(formatInvoiceNumber(2026, 999999), "SKHL-INV-2026-999999");
});

test("the sequence resets per calendar year, so the year is part of the identity", () => {
  assert.notEqual(formatInvoiceNumber(2026, 1), formatInvoiceNumber(2027, 1));
  assert.equal(formatInvoiceNumber(2027, 1), "SKHL-INV-2027-000001");
});

// --- Billing anniversary ----------------------------------------------------

test("the anniversary is the activation day, not the first of the month", () => {
  const activated = new Date(Date.UTC(2026, 10, 17, 9, 30, 0)); // 17 November
  const { periodStart, periodEnd, anchorDay } = periodFrom(activated);
  assert.equal(anchorDay, 17);
  assert.deepEqual(periodStart, activated);
  assert.equal(periodEnd.getUTCMonth(), 11, "December");
  assert.equal(periodEnd.getUTCDate(), 17, "still the 17th");
});

test("a month-end anniversary clamps for short months but does not drift permanently", () => {
  // 31 January, anchored on 31.
  const jan31 = new Date(Date.UTC(2026, 0, 31, 9, 0, 0));
  const feb = addOneMonth(jan31, 31);
  assert.equal(feb.getUTCMonth(), 1, "February");
  assert.equal(feb.getUTCDate(), 28, "clamped to the last day of February 2026");

  // The anchor is carried, not re-derived from the clamped date, so March
  // returns to the 31st instead of staying on the 28th.
  const mar = addOneMonth(feb, 31);
  assert.equal(mar.getUTCMonth(), 2, "March");
  assert.equal(mar.getUTCDate(), 31, "back to the 31st — the anniversary never drifts");
});

test("a leap February takes the 29th", () => {
  const jan31 = new Date(Date.UTC(2028, 0, 31, 9, 0, 0));
  const feb = addOneMonth(jan31, 31);
  assert.equal(feb.getUTCDate(), 29, "2028 is a leap year");
});

// --- Trial ------------------------------------------------------------------

test("the trial is 14 days from activation", () => {
  const { start, end } = trialPeriod(day(0));
  assert.equal(TRIAL_DAYS, 14);
  assert.deepEqual(start, day(0));
  assert.deepEqual(end, day(14));
});

test("a running trial grants its plan; an ended one falls to FREE with NO grace", () => {
  const now = day(20);
  const running = subscriptionAccess(
    { planId: "grow", status: "TRIALING", currentPeriodEnd: day(25), graceEndsAt: null },
    now,
  );
  assert.equal(running.usesSubscribedPlan, true);
  assert.equal(running.state, "TRIALING");

  // Ended yesterday. A paid plan would get 10 days of grace here; a trial
  // must not, or the advertised 14 days would quietly be 24.
  const ended = subscriptionAccess(
    { planId: "grow", status: "TRIALING", currentPeriodEnd: day(19), graceEndsAt: null },
    now,
  );
  assert.equal(ended.usesSubscribedPlan, false, "no grace after a free trial");
  assert.equal(ended.state, "EXPIRED");
  assert.equal(ended.accessUntil, null);
});

test("a lapsed PAID plan still gets its grace — the trial rule must not have broken that", () => {
  const lapsed = subscriptionAccess(
    { planId: "grow", status: "ACTIVE", currentPeriodEnd: day(19), graceEndsAt: null },
    day(20),
  );
  assert.equal(lapsed.usesSubscribedPlan, true);
  assert.equal(lapsed.state, "GRACE");
});

// --- Grace ------------------------------------------------------------------

test("grace is 10 days, leaving room after the last planned card retry on day 8", () => {
  assert.equal(SUBSCRIPTION_GRACE_DAYS, 10);
  const due = day(0);
  assert.deepEqual(graceEndFor(due), day(10));
  // The Phase B retry schedule is 0, 2, 5, 8 — all strictly before grace ends.
  for (const retryDay of [0, 2, 5, 8]) {
    assert.ok(retryDay < SUBSCRIPTION_GRACE_DAYS, `retry on day ${retryDay} lands inside grace`);
  }
});

test("payment terms are 7 days", () => {
  assert.equal(PAYMENT_TERMS_DAYS, 7);
});

// --- Dunning state machine --------------------------------------------------

test("the dunning cadence fires once per stage, in order", () => {
  const due = day(0);
  const seen: string[] = [];
  let last: string | null = null;

  // Walk day by day, as the nightly cron does.
  for (let d = -5; d <= 12; d += 1) {
    const stage = noticeStageFor({ dueAt: due, lastNoticeStage: last }, day(d));
    if (stage) {
      seen.push(`${d}:${stage}`);
      last = stage;
    }
  }

  assert.deepEqual(seen, [
    "-3:due_soon",
    "0:due_today",
    "3:overdue",
    "7:final_warning",
    "10:downgraded",
  ]);
});

test("a cron run that repeats the same night sends nothing twice", () => {
  const due = day(0);
  const first = noticeStageFor({ dueAt: due, lastNoticeStage: null }, day(0));
  assert.equal(first, "due_today");
  const again = noticeStageFor({ dueAt: due, lastNoticeStage: "due_today" }, day(0));
  assert.equal(again, null, "idempotent within a stage");
});

test("a cron that missed several nights catches up with one notice, not the whole backlog", () => {
  const due = day(0);
  // Last notice was the day-0 one; the sweep next runs on day 8.
  const stage = noticeStageFor({ dueAt: due, lastNoticeStage: "due_today" }, day(8));
  assert.equal(stage, "final_warning", "the furthest stage reached, sent once");
});

test("an invoice with no due date is never chased", () => {
  assert.equal(noticeStageFor({ dueAt: null, lastNoticeStage: null }, day(99)), null);
});

test("nothing is sent before the first stage is reached", () => {
  const due = day(0);
  assert.equal(noticeStageFor({ dueAt: due, lastNoticeStage: null }, day(-4)), null);
});

// --- Limit refusals ---------------------------------------------------------

test("a limit refusal names the limit, the upgrade, and promises nothing was lost", () => {
  const message = limitMessage("max_products", 50, { name: "Grow", limit: 200 });
  assert.match(message, /50 products/);
  assert.match(message, /Grow/);
  assert.match(message, /200/);
  assert.match(message, /stays exactly as it is/i, "an owner after a downgrade needs this promise");
});

test("a refusal with no plan to upgrade to stays honest instead of inventing one", () => {
  const message = limitMessage("max_staff", 20, null);
  assert.match(message, /20 team members/);
  assert.doesNotMatch(message, /Moving to/);
  assert.match(message, /get in touch/i);
});

test("an unlimited upgrade is described as such, not as a number", () => {
  const message = limitMessage("max_services", 25, { name: "Pro", limit: null });
  assert.match(message, /as many as you need/);
});

test("a plan that includes none of something says so rather than claiming a limit of 0", () => {
  const message = limitMessage("max_products", 0, { name: "Grow", limit: 200 });
  assert.match(message, /doesn't include products/);
});

test("every enforced limit has wording for one and for many", () => {
  for (const [key, nouns] of Object.entries(ENFORCED_LIMITS)) {
    assert.ok(nouns.one.length > 0, key);
    assert.ok(nouns.many.length > 0, key);
    assert.notEqual(nouns.one, nouns.many, `${key} distinguishes singular from plural`);
  }
});

// --- Managed services vs SaaS ----------------------------------------------

test("the managed Content & Marketing Service is named apart from the Content Studio in the plans", () => {
  const content = managedService("content");
  assert.ok(content);
  assert.equal(content.name, "Managed Content & Marketing Service");
  assert.doesNotMatch(content.name, /^Content dashboard$/, "renamed so it is never confused with the plan feature");
  assert.equal(content.setupCents, 500_000);
  assert.equal(content.monthlyCents, 150_000);
});

test("managed service prices are whole cents and match the commercial spec", () => {
  const expected: Record<string, [number, number]> = {
    website: [150_000, 30_000],
    "whatsapp-ordering": [300_000, 100_000],
    "voice-agent": [250_000, 150_000],
    content: [500_000, 150_000],
    "speed-to-lead": [450_000, 100_000],
  };
  assert.equal(MANAGED_SERVICES.length, 5);
  for (const service of MANAGED_SERVICES) {
    const want = expected[service.slug];
    assert.ok(want, `unexpected service ${service.slug}`);
    assert.deepEqual([service.setupCents, service.monthlyCents], want, service.slug);
    assert.ok(Number.isInteger(service.setupCents) && Number.isInteger(service.monthlyCents), service.slug);
  }
});

test("an unknown service slug returns null rather than throwing", () => {
  assert.equal(managedService("not-a-service"), null);
});

// --- Namespace separation from merchant payments ---------------------------

test("platform billing references use the skhp_ namespace, never the merchant skh_ one", () => {
  for (let i = 0; i < 50; i += 1) {
    const reference = platformReference();
    assert.match(reference, /^skhp_[0-9a-f]{32}$/);
    assert.ok(!reference.startsWith("skh_"), "must not collide with a merchant payment attempt");
  }
});

test("two platform references are never the same", () => {
  const seen = new Set(Array.from({ length: 200 }, () => platformReference()));
  assert.equal(seen.size, 200);
});

// --- Platform PayFast account must fail closed (brief item 6) --------------

test("in production, platform payments are refused outright when PAYFAST_MERCHANT_* is unset", () => {
  withEnv(
    {
      NODE_ENV: "production",
      PAYFAST_MERCHANT_ID: undefined,
      PAYFAST_MERCHANT_KEY: undefined,
      PAYFAST_SANDBOX: undefined,
    },
    () => {
      assert.equal(platformPaymentMode(), "unconfigured");
      // Never a silent fall back to PayFast's public sandbox account, which
      // would look like a working payment while no money moved.
      assert.throws(() => platformCredentials(), /not configured/);
    },
  );
});

test("the platform account is only live once its credentials are actually set", () => {
  withEnv(
    { NODE_ENV: "production", PAYFAST_MERCHANT_ID: "10011001", PAYFAST_MERCHANT_KEY: "k", PAYFAST_PASSPHRASE: "p", PAYFAST_SANDBOX: undefined },
    () => {
      assert.equal(platformPaymentMode(), "live");
      const credentials = platformCredentials();
      assert.equal(credentials.environment, "LIVE");
      assert.equal(credentials.merchantId, "10011001");
      assert.notEqual(credentials.merchantId, "10000100", "never the public sandbox merchant");
    },
  );
});

test("the public sandbox account is only ever used when asked for deliberately", () => {
  withEnv({ NODE_ENV: "production", PAYFAST_SANDBOX: "true", PAYFAST_MERCHANT_ID: undefined }, () => {
    assert.equal(platformPaymentMode(), "sandbox");
    assert.equal(platformCredentials().environment, "SANDBOX");
  });
});
