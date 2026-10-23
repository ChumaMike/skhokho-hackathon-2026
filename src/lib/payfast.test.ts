import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  buildPaymentFields,
  verifyItnSignature,
  payfastProcessUrl,
  payfastValidateUrl,
  platformPaymentMode,
  platformCredentials,
  type PayfastCredentials,
} from "./payfast";

/**
 * The protocol layer, tested with credentials passed in — which is the whole
 * point of the refactor. Two different merchants must produce two different
 * signatures from the same order, or merchant-direct settlement is a fiction.
 */

const MERCHANT_A: PayfastCredentials = {
  merchantId: "10000100",
  merchantKey: "46f0cd694581a",
  passphrase: "merchant-a-passphrase",
  environment: "SANDBOX",
};

const MERCHANT_B: PayfastCredentials = {
  merchantId: "20000200",
  merchantKey: "aaaaaaaaaaaaa",
  passphrase: "merchant-b-passphrase",
  environment: "SANDBOX",
};

const INPUT = {
  reference: "att_abc123",
  amount: 130,
  itemName: "Order ORD-1042",
  returnUrl: "https://shop.example/store/kasi?ok=order",
  cancelUrl: "https://shop.example/store/kasi?err=cancelled",
  notifyUrl: "https://shop.example/api/payments/payfast/notify",
};

function asMap(fields: [string, string][]): Record<string, string> {
  return Object.fromEntries(fields);
}

/** PayFast's outbound rule, computed independently of the implementation. */
function expectedOutboundSignature(fields: [string, string][], passphrase?: string): string {
  const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, "+");
  const parts = fields
    .filter(([key, value]) => key !== "signature" && value !== "")
    .map(([key, value]) => `${key}=${enc(value)}`);
  if (passphrase) parts.push(`passphrase=${enc(passphrase)}`);
  return crypto.createHash("md5").update(parts.join("&")).digest("hex");
}

// --- outbound ---------------------------------------------------------------

test("the payment carries the given merchant's id and key, not a platform one", () => {
  const map = asMap(buildPaymentFields(INPUT, MERCHANT_A));
  assert.equal(map.merchant_id, "10000100");
  assert.equal(map.merchant_key, "46f0cd694581a");
});

test("two merchants produce different signatures for the identical order", () => {
  // If this ever passes with equal signatures, every merchant is effectively
  // sharing one account again.
  const a = asMap(buildPaymentFields(INPUT, MERCHANT_A));
  const b = asMap(buildPaymentFields(INPUT, MERCHANT_B));
  assert.notEqual(a.signature, b.signature);
  assert.notEqual(a.merchant_id, b.merchant_id);
});

test("the signature matches PayFast's documented outbound rule", () => {
  const fields = buildPaymentFields(INPUT, MERCHANT_A);
  const signature = asMap(fields).signature;
  assert.equal(signature, expectedOutboundSignature(fields, MERCHANT_A.passphrase));
});

test("the passphrase is appended last and changes the signature", () => {
  const withPass = asMap(buildPaymentFields(INPUT, MERCHANT_A)).signature;
  const without = asMap(buildPaymentFields(INPUT, { ...MERCHANT_A, passphrase: undefined })).signature;
  assert.notEqual(withPass, without);
});

test("m_payment_id carries the attempt reference, never an order id", () => {
  // The distinction that lets one order be retried without ambiguity.
  const map = asMap(buildPaymentFields(INPUT, MERCHANT_A));
  assert.equal(map.m_payment_id, "att_abc123");
});

test("the amount is sent with two decimals", () => {
  assert.equal(asMap(buildPaymentFields({ ...INPUT, amount: 7 }, MERCHANT_A)).amount, "7.00");
  assert.equal(asMap(buildPaymentFields({ ...INPUT, amount: 130.5 }, MERCHANT_A)).amount, "130.50");
});

test("item_name is capped at PayFast's 100-character limit", () => {
  const map = asMap(buildPaymentFields({ ...INPUT, itemName: "x".repeat(250) }, MERCHANT_A));
  assert.equal(map.item_name.length, 100);
});

// --- environment ------------------------------------------------------------

test("each environment resolves to its own hosts", () => {
  assert.match(payfastProcessUrl("SANDBOX"), /sandbox\.payfast\.co\.za/);
  assert.match(payfastProcessUrl("LIVE"), /^https:\/\/www\.payfast\.co\.za/);
  assert.match(payfastValidateUrl("SANDBOX"), /sandbox\.payfast\.co\.za.*validate/);
  assert.match(payfastValidateUrl("LIVE"), /^https:\/\/www\.payfast\.co\.za.*validate/);
});

// --- inbound ----------------------------------------------------------------

/** Signs an ITN the way PayFast does: all posted fields, in order, empties included. */
function signLikePayfast(ordered: [string, string][], passphrase?: string): string {
  const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, "+");
  const parts = ordered.map(([k, v]) => `${k}=${enc(v)}`);
  if (passphrase) parts.push(`passphrase=${enc(passphrase)}`);
  return crypto.createHash("md5").update(parts.join("&")).digest("hex");
}

const ITN_BODY: [string, string][] = [
  ["m_payment_id", "att_abc123"],
  ["pf_payment_id", "1089250"],
  ["payment_status", "COMPLETE"],
  ["item_name", "Order ORD-1042"],
  ["amount_gross", "130.00"],
  ["amount_fee", "-5.98"],
  ["amount_net", "124.02"],
  // Real PayFast notifications carry empty custom fields. Dropping them was
  // the bug this direction used to have.
  ["custom_str1", ""],
  ["custom_str2", ""],
  ["merchant_id", "10000100"],
];

test("a genuine notification verifies", () => {
  const signature = signLikePayfast(ITN_BODY, MERCHANT_A.passphrase);
  assert.equal(verifyItnSignature([...ITN_BODY, ["signature", signature]], MERCHANT_A), true);
});

test("empty fields are included when verifying — the live-only failure", () => {
  // Signed WITH the empty custom_str fields, as PayFast does. If verification
  // dropped them it would compute a different digest and reject a real payment.
  const signature = signLikePayfast(ITN_BODY, MERCHANT_A.passphrase);
  const hasEmpties = ITN_BODY.some(([, v]) => v === "");
  assert.ok(hasEmpties, "fixture must contain empty fields for this to mean anything");
  assert.equal(verifyItnSignature([...ITN_BODY, ["signature", signature]], MERCHANT_A), true);
});

test("a notification signed with another merchant's passphrase is rejected", () => {
  // The core of tenant isolation at the protocol level.
  const signature = signLikePayfast(ITN_BODY, MERCHANT_B.passphrase);
  assert.equal(verifyItnSignature([...ITN_BODY, ["signature", signature]], MERCHANT_A), false);
});

test("a tampered amount invalidates the signature", () => {
  const signature = signLikePayfast(ITN_BODY, MERCHANT_A.passphrase);
  const tampered = ITN_BODY.map(([k, v]) =>
    k === "amount_gross" ? ([k, "1300.00"] as [string, string]) : ([k, v] as [string, string]),
  );
  assert.equal(verifyItnSignature([...tampered, ["signature", signature]], MERCHANT_A), false);
});

test("a missing signature is rejected rather than treated as absent-and-fine", () => {
  assert.equal(verifyItnSignature(ITN_BODY, MERCHANT_A), false);
});

test("reordered fields are rejected — order is part of the signature", () => {
  const signature = signLikePayfast(ITN_BODY, MERCHANT_A.passphrase);
  const reordered = [...ITN_BODY].reverse();
  assert.equal(verifyItnSignature([...reordered, ["signature", signature]], MERCHANT_A), false);
});

// --- platform account -------------------------------------------------------

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const keys = ["NODE_ENV", "PAYFAST_MERCHANT_ID", "PAYFAST_MERCHANT_KEY", "PAYFAST_SANDBOX"] as const;
  const e = process.env as Record<string, string | undefined>;
  const saved = Object.fromEntries(keys.map((k) => [k, e[k]]));
  try {
    for (const k of keys) {
      if (env[k] === undefined) delete e[k];
      else e[k] = env[k];
    }
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete e[k];
      else e[k] = saved[k];
    }
  }
}

test("the platform account is unconfigured in production rather than silently sandbox", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.equal(platformPaymentMode(), "unconfigured");
    assert.throws(() => platformCredentials(), /not configured/);
  });
});

test("development still falls back to PayFast's public sandbox account", () => {
  withEnv({ NODE_ENV: "development" }, () => {
    assert.equal(platformPaymentMode(), "sandbox");
    assert.equal(platformCredentials().merchantId, "10000100");
    assert.equal(platformCredentials().environment, "SANDBOX");
  });
});

test("an explicit sandbox flag beats configured live credentials", () => {
  withEnv({ NODE_ENV: "production", PAYFAST_MERCHANT_ID: "99999", PAYFAST_SANDBOX: "true" }, () => {
    assert.equal(platformPaymentMode(), "sandbox");
  });
});
