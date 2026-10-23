import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import {
  requestEmailChange,
  confirmEmailChange,
  reissueEmailChange,
  cancelEmailChange,
  getBusinessEmailState,
  BusinessEmailError,
  EMAIL_CHANGE_TTL_MS,
} from "./business-email";

/**
 * Editable business contact email: the new address never becomes the public
 * contact until a link sent to it is opened; links expire, can be reissued,
 * and are single-use.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const created: string[] = [];

async function business(label: string) {
  const b = await prisma.business.create({
    data: { name: `Email ${label}`, slug: `email-${label}-${run}`, email: `old-${label}-${run}@example.test` },
    select: { id: true },
  });
  created.push(b.id);
  return b;
}

test.after(async () => {
  await prisma.business.deleteMany({ where: { id: { in: created } } });
});

test("requesting a change parks the new address; the public email is untouched until the link is opened", async () => {
  const b = await business("park");
  const { pendingEmail, token } = await requestEmailChange(b.id, "  New-Shop@Example.TEST ");
  assert.equal(pendingEmail, "new-shop@example.test");
  assert.ok(token.length >= 32);

  let state = await getBusinessEmailState(b.id);
  assert.equal(state.email, `old-park-${run}@example.test`);
  assert.equal(state.pendingEmail, "new-shop@example.test");
  assert.equal(state.pendingLinkValid, true);

  const applied = await confirmEmailChange(token);
  assert.deepEqual(applied, { businessId: b.id, email: "new-shop@example.test" });
  state = await getBusinessEmailState(b.id);
  assert.equal(state.email, "new-shop@example.test");
  assert.ok(state.emailVerifiedAt);
  assert.equal(state.pendingEmail, null);

  // Single use.
  assert.equal(await confirmEmailChange(token), null);
});

test("the raw token is never stored, and a wrong or expired link changes nothing", async () => {
  const b = await business("expire");
  const { token } = await requestEmailChange(b.id, `later-${run}@example.test`, new Date(Date.now() - EMAIL_CHANGE_TTL_MS - 1000));
  const row = await prisma.businessEmailChange.findUniqueOrThrow({ where: { businessId: b.id }, select: { tokenHash: true } });
  assert.notEqual(row.tokenHash, token);
  assert.equal(await confirmEmailChange(token), null, "expired");
  assert.equal(await confirmEmailChange("not-a-real-token-at-all-xxxxxxxx"), null);
  assert.equal((await getBusinessEmailState(b.id)).email, `old-expire-${run}@example.test`);
});

test("reissuing invalidates the earlier link; cancelling clears the pending address", async () => {
  const b = await business("reissue");
  const first = await requestEmailChange(b.id, `again-${run}@example.test`);
  const second = await reissueEmailChange(b.id);
  assert.ok(second);
  assert.equal(second!.pendingEmail, `again-${run}@example.test`);
  assert.equal(await confirmEmailChange(first.token), null, "old link dead");

  await cancelEmailChange(b.id);
  const state = await getBusinessEmailState(b.id);
  assert.equal(state.pendingEmail, null);
  assert.equal(await confirmEmailChange(second!.token), null, "cancelled link dead");
  assert.equal(await reissueEmailChange(b.id), null);
});

test("an invalid address, or the address already in use, is refused before anything is written", async () => {
  const b = await business("invalid");
  await assert.rejects(requestEmailChange(b.id, "not-an-email"), BusinessEmailError);
  await assert.rejects(requestEmailChange(b.id, `old-invalid-${run}@example.test`), BusinessEmailError);
  assert.equal((await getBusinessEmailState(b.id)).pendingEmail, null);
});
