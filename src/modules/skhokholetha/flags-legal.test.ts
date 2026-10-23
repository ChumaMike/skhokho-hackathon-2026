import test from "node:test";
import assert from "node:assert/strict";
import { lethaEnabled, LETHA_FLAG_NAMES, requireLetha, FeatureDisabledError } from "./flags";
import { acceptedCurrentLegal, driverLegalConfig } from "./legal";
import { setEnv, TEST_LEGAL_ENV } from "./testing";

const CLEAR = Object.fromEntries([...LETHA_FLAG_NAMES, ...Object.keys(TEST_LEGAL_ENV)].map((k) => [k, undefined]));

test("with nothing configured, every Skhokholetha switch is OFF and the legal config is incomplete", () => {
  const restore = setEnv(CLEAR);
  try {
    for (const f of ["network", "driverSignup", "deliveryRequests", "driverApprovals"] as const) {
      assert.equal(lethaEnabled(f), false, f);
      assert.throws(() => requireLetha(f), FeatureDisabledError);
    }
    const legal = driverLegalConfig();
    assert.equal(legal.ok, false);
    if (!legal.ok) assert.equal(legal.missing.length, 4);
  } finally {
    restore();
  }
});

test("each sub-switch needs the master switch, and is independent of the others", () => {
  const restore = setEnv({ ...CLEAR, SKHOKHOLETHA_ENABLED: "true", DELIVERY_REQUESTS_ENABLED: "true" });
  try {
    assert.equal(lethaEnabled("network"), true);
    assert.equal(lethaEnabled("deliveryRequests"), true);
    assert.equal(lethaEnabled("driverSignup"), false);
    assert.equal(lethaEnabled("driverApprovals"), false);
  } finally {
    restore();
  }
});

test("legal config: versions must be well-formed and URLs https; acceptance must match both current versions", () => {
  const restore = setEnv({ ...CLEAR, ...TEST_LEGAL_ENV });
  try {
    const legal = driverLegalConfig();
    assert.ok(legal.ok);
    const at = new Date();
    const accepted = { agreementVersion: "test-terms-1", agreementAcceptedAt: at, privacyVersion: "test-privacy-1", privacyAcceptedAt: at };
    assert.equal(acceptedCurrentLegal(accepted, legal), true);
    assert.equal(acceptedCurrentLegal({ ...accepted, privacyVersion: "old" }, legal), false);
    assert.equal(acceptedCurrentLegal({ ...accepted, agreementAcceptedAt: null }, legal), false);

    process.env.DRIVER_TERMS_VERSION = "has spaces";
    assert.equal(driverLegalConfig().ok, false);
    process.env.DRIVER_TERMS_VERSION = "v1";
    process.env.DRIVER_TERMS_URL = "javascript:alert(1)";
    assert.equal(driverLegalConfig().ok, false);
    process.env.DRIVER_TERMS_URL = "ftp://example.test/terms";
    assert.equal(driverLegalConfig().ok, false);
  } finally {
    restore();
  }
});
