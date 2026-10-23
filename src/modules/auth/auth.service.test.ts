import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, signToken, verifyToken } from "./auth.service";

// getSecret() reads process.env.JWT_SECRET lazily, on first call, so setting
// it here (before any test runs) is enough — no import-order trick needed.
process.env.JWT_SECRET ??= "test-secret-at-least-32-characters-long!!";

test("hashPassword rejects short passwords", async () => {
  await assert.rejects(() => hashPassword("short"));
});

test("hashPassword/verifyPassword round-trip", async () => {
  const hash = await hashPassword("correct-horse-battery-staple");
  assert.equal(await verifyPassword("correct-horse-battery-staple", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("verifyPassword returns false for empty inputs rather than throwing", async () => {
  assert.equal(await verifyPassword("", "somehash"), false);
  assert.equal(await verifyPassword("pw", ""), false);
});

test("signToken/verifyToken round-trip for a staff token", async () => {
  const token = await signToken({
    type: "staff",
    staffId: "staff-1",
    tenantId: "tenant-1",
    email: "owner@example.com",
    isOwner: true,
  });

  const payload = await verifyToken(token);
  assert.equal(payload.type, "staff");
  if (payload.type === "staff") {
    assert.equal(payload.staffId, "staff-1");
    assert.equal(payload.tenantId, "tenant-1");
    assert.equal(payload.isOwner, true);
  }
});

test("verifyToken rejects a malformed token", async () => {
  await assert.rejects(() => verifyToken("not-a-jwt"));
});

test("verifyToken rejects an empty token", async () => {
  await assert.rejects(() => verifyToken(""));
});

test("verifyToken rejects a token signed with a different secret", async () => {
  const { SignJWT } = await import("jose");
  const wrongSecret = new TextEncoder().encode("a-completely-different-32-char-secret!!");
  const now = Math.floor(Date.now() / 1000);
  const forged = await new SignJWT({ type: "staff", staffId: "x", tenantId: "y", email: "a@b.com", isOwner: true })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("skhokho-platform")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(wrongSecret);

  await assert.rejects(() => verifyToken(forged));
});

test("verifyToken rejects an expired token", async () => {
  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const past = Math.floor(Date.now() / 1000) - 1000;
  const expired = await new SignJWT({ type: "staff", staffId: "x", tenantId: "y", email: "a@b.com", isOwner: true })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("skhokho-platform")
    .setIssuedAt(past)
    .setExpirationTime(past + 1)
    .sign(secret);

  await assert.rejects(() => verifyToken(expired));
});
