import test from "node:test";
import assert from "node:assert/strict";
import { ENV_VARS, validateEnvironment } from "./env-check";
import { getAppUrl } from "./utils";

const complete = {
  POSTGRES_PRISMA_URL: "postgresql://x",
  POSTGRES_URL_NON_POOLING: "postgresql://y",
  JWT_SECRET: "x".repeat(40),
  NEXT_PUBLIC_APP_URL: "https://app.skhokholabs.app",
  CRON_SECRET: "c",
};

test("a complete startup configuration has nothing fatal", () => {
  assert.deepEqual(validateEnvironment(complete).fatal, []);
});

test("each missing startup variable is fatal; feature variables only disable their feature", () => {
  for (const key of Object.keys(complete)) {
    const env: Record<string, string | undefined> = { ...complete, [key]: undefined };
    assert.ok(validateEnvironment(env).fatal.some((l) => l.startsWith(key)), key);
  }
  const report = validateEnvironment(complete);
  assert.ok(report.disabled.some((l) => l.startsWith("PAYMENT_ENCRYPTION_KEY")));
  assert.ok(report.disabled.some((l) => l.startsWith("VERCEL_DOMAINS_TOKEN")));
});

test("Web Push is reported as off until all three VAPID variables are set and well formed", () => {
  const publicKey = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
  const privateKey = "tUxYj4zJqM1dK7eVbT1Rn2XGwqv3sLJfQm8bC6hZ0aE";
  const off = validateEnvironment(complete).disabled.filter((l) => l.startsWith("WEBPUSH_"));
  assert.equal(off.length, 3, "all three named while unset");
  assert.match(off[0], /hidden/);
  const on = { ...complete, WEBPUSH_VAPID_PUBLIC_KEY: publicKey, WEBPUSH_VAPID_PRIVATE_KEY: privateKey, WEBPUSH_SUBJECT: "mailto:help@skhokho.test" };
  assert.equal(validateEnvironment(on).disabled.filter((l) => l.startsWith("WEBPUSH_")).length, 0);
  assert.deepEqual(validateEnvironment(on).fatal, [], "never fatal: a feature, not a startup need");
  const halfSet = validateEnvironment({ ...on, WEBPUSH_VAPID_PRIVATE_KEY: undefined }).disabled.filter((l) => l.startsWith("WEBPUSH_"));
  assert.equal(halfSet.length, 1, "the one missing is named");
  const badKey = validateEnvironment({ ...on, WEBPUSH_VAPID_PUBLIC_KEY: "not-a-key" }).disabled;
  assert.ok(badKey.some((l) => l.startsWith("WEBPUSH_VAPID_PUBLIC_KEY must be")));
  const badSubject = validateEnvironment({ ...on, WEBPUSH_SUBJECT: "help@skhokho.test" }).disabled;
  assert.ok(badSubject.some((l) => l.startsWith("WEBPUSH_SUBJECT must be")));
});

test("insecure values are refused, not accepted with a warning", () => {
  assert.ok(validateEnvironment({ ...complete, JWT_SECRET: "short" }).fatal.some((l) => l.startsWith("JWT_SECRET")));
  assert.ok(validateEnvironment({ ...complete, NEXT_PUBLIC_APP_URL: "http://app.example" }).fatal.some((l) => l.startsWith("NEXT_PUBLIC_APP_URL")));
});

test("MESSAGE_PROVIDER accepts the providers the seam knows, refuses console in production, names the rest", () => {
  const problems = (env: Record<string, string | undefined>) => validateEnvironment(env).disabled.filter((l) => l.startsWith("MESSAGE_PROVIDER"));
  assert.equal(validateEnvironment(complete).disabled.filter((l) => l.startsWith("MESSAGE_PROVIDER")).length, 1, "unset is reported once, as off");
  for (const ok of ["bulksms", "whatsapp", "WhatsApp ", "console"]) {
    assert.deepEqual(problems({ ...complete, MESSAGE_PROVIDER: ok }), [], `${ok} is accepted outside production`);
  }
  const wrong = problems({ ...complete, MESSAGE_PROVIDER: "twilio" });
  assert.equal(wrong.length, 1);
  assert.match(wrong[0], /"twilio"/);
  assert.match(wrong[0], /"console", "bulksms", "whatsapp"/);
  const saved = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "production";
    assert.match(problems({ ...complete, MESSAGE_PROVIDER: "console" })[0] ?? "", /refused in production/);
    assert.deepEqual(problems({ ...complete, MESSAGE_PROVIDER: "whatsapp" }), []);
  } finally {
    if (saved === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved;
  }
});

test("every variable is classified exactly once", () => {
  const names = ENV_VARS.map((v) => v.name);
  assert.equal(new Set(names).size, names.length);
});

test("production never builds a link from the request's Host header", () => {
  const saved = { app: process.env.NEXT_PUBLIC_APP_URL, env: process.env.VERCEL_ENV };
  try {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_ENV = "production";
    assert.throws(() => getAppUrl("https://attacker.example"), /must be set in production/);
    process.env.VERCEL_ENV = "preview";
    assert.equal(getAppUrl("https://preview.example"), "https://preview.example");
  } finally {
    if (saved.app === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = saved.app;
    if (saved.env === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved.env;
  }
});
