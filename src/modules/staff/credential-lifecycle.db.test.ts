import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { AuthError, assertSessionStillActive } from "@/lib/auth/guards";
import { hashPassword, verifyPassword } from "@/modules/auth/auth.service";
import { POST as staffLoginPOST } from "@/app/api/platform/staff-login/route";
import { createBusiness, updateBusiness, WHATSAPP_FORMAT_MESSAGE } from "@/modules/tenant/tenant.service";
import { completeStaffSetPassword, inviteStaff, reactivateStaff, reinviteStaff, setStaffActive } from "./staff.service";

/**
 * B3 / B4 / B11 against a real database: credentials can only come from the
 * path that owns them, and deactivation really revokes access.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const businesses: string[] = [];
const appUsers: string[] = [];
const OWNER_PASSWORD = "owner-password-123";

async function makeOwnedBusiness(label: string) {
  const email = `owner-${label}-${run}@example.test`;
  const appUser = await prisma.appUser.create({
    data: { email, passwordHash: await hashPassword(OWNER_PASSWORD), role: "OWNER", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  appUsers.push(appUser.id);
  const { business, owner } = await createBusiness({
    name: `Cred ${label}`,
    category: "FOOD_VENDOR",
    email,
    owner: { firstName: "Thandi", lastName: "Owner", email, passwordHash: await hashPassword(OWNER_PASSWORD) },
  });
  businesses.push(business.id);
  await prisma.business.update({ where: { id: business.id }, data: { ownerUserId: appUser.id } });
  return { business, owner, appUserId: appUser.id, email };
}

function staffLogin(slug: string, email: string, password: string) {
  const form = new URLSearchParams({ business: slug, email, password });
  return staffLoginPOST(
    new NextRequest("https://app.example.test/api/platform/staff-login", {
      method: "POST",
      body: form.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }),
  );
}

const signedIn = (res: Response) => /skhokho-staff-token=/.test(res.headers.get("set-cookie") ?? "");

test.after(async () => {
  await prisma.businessStaff.deleteMany({ where: { businessId: { in: businesses } } });
  await prisma.businessRole.deleteMany({ where: { businessId: { in: businesses } } });
  await prisma.businessSubscription.deleteMany({ where: { businessId: { in: businesses } } });
  await prisma.business.deleteMany({ where: { id: { in: businesses } } });
  await prisma.appUser.deleteMany({ where: { id: { in: appUsers } } });
});

// ---------------------------------------------------------------------------
// B3 — owners have exactly one way in, and a reset closes it to old passwords
// ---------------------------------------------------------------------------

test("B3: a new owner's BusinessStaff row holds no usable password", async () => {
  const { owner } = await makeOwnedBusiness("newrow");
  assert.equal(owner.isOwner, true);
  assert.equal(await verifyPassword(OWNER_PASSWORD, owner.passwordHash), false);
});

test("B3: /staff-login refuses an owner row even with the right (legacy) password", async () => {
  const { business, owner, email } = await makeOwnedBusiness("legacy");
  // A row created before this fix carried a copy of the owner's password.
  await prisma.businessStaff.update({ where: { id: owner.id }, data: { passwordHash: await hashPassword(OWNER_PASSWORD) } });
  const res = await staffLogin(business.slug, email, OWNER_PASSWORD);
  assert.equal(signedIn(res), false, "no session issued");
  assert.match(res.headers.get("location") ?? "", /err=Email%20or%20password%20is%20wrong/);
});

test("B3: the migration's sentinel can never verify as a password", async () => {
  assert.equal(await verifyPassword(OWNER_PASSWORD, "!owner-signs-in-at-login"), false);
  assert.equal(await verifyPassword("", "!owner-signs-in-at-login"), false);
});

test("B3: a deactivated owner account loses its session on the next request", async () => {
  const { business, appUserId } = await makeOwnedBusiness("owneroff");
  await assert.doesNotReject(assertSessionStillActive({ staffId: appUserId, tenantId: business.id, isOwner: true }));
  await prisma.appUser.update({ where: { id: appUserId }, data: { isActive: false } });
  await assert.rejects(assertSessionStillActive({ staffId: appUserId, tenantId: business.id, isOwner: true }), AuthError);
});

// ---------------------------------------------------------------------------
// B4 — deactivation revokes everything; coming back is a fresh credential
// ---------------------------------------------------------------------------

async function invitedAndSet(businessId: string, label: string, password: string) {
  const { staff, token } = await inviteStaff(businessId, { firstName: label, lastName: "Staff", email: `${label}-${run}@example.test`, preset: "COUNTER" });
  await completeStaffSetPassword(token, password);
  return staff;
}

test("B4: an active member signs in (positive control)", async () => {
  const { business } = await makeOwnedBusiness("control");
  const staff = await invitedAndSet(business.id, "sipho", "sipho-password-1");
  assert.equal(signedIn(await staffLogin(business.slug, staff.email, "sipho-password-1")), true);
  await assert.doesNotReject(assertSessionStillActive({ staffId: staff.id, tenantId: business.id, isOwner: false }));
});

test("B4: deactivating revokes the password, unused links and the live session", async () => {
  const { business } = await makeOwnedBusiness("revoke");
  const staff = await invitedAndSet(business.id, "lerato", "lerato-password-1");
  // An outstanding link (e.g. a resent invite they never used).
  const { token: pendingLink } = await reinviteStaff(business.id, staff.id);

  await setStaffActive(business.id, staff.id, false);

  const row = await prisma.businessStaff.findUniqueOrThrow({ where: { id: staff.id } });
  assert.equal(row.isActive, false);
  assert.equal(row.resetToken, null);
  assert.equal(await verifyPassword("lerato-password-1", row.passwordHash), false, "old password is gone");
  assert.equal(signedIn(await staffLogin(business.slug, staff.email, "lerato-password-1")), false);
  await assert.rejects(completeStaffSetPassword(pendingLink, "new-password-99"), /expired/);
  assert.equal((await prisma.businessStaff.findUniqueOrThrow({ where: { id: staff.id } })).isActive, false, "a link never reactivates");
  await assert.rejects(assertSessionStillActive({ staffId: staff.id, tenantId: business.id, isOwner: false }), AuthError);
  await assert.rejects(reinviteStaff(business.id, staff.id), /Reactivate/);
});

test("B4: even a link that survived can't be used by an inactive member", async () => {
  const { business } = await makeOwnedBusiness("survive");
  const staff = await invitedAndSet(business.id, "zanele", "zanele-password-1");
  const { token } = await reinviteStaff(business.id, staff.id);
  // Simulate a pre-fix deactivation that left the token in place.
  await prisma.businessStaff.update({ where: { id: staff.id }, data: { isActive: false } });
  await assert.rejects(completeStaffSetPassword(token, "sneaky-password-1"), /expired/);
  assert.equal((await prisma.businessStaff.findUniqueOrThrow({ where: { id: staff.id } })).isActive, false);
});

test("B4: reactivation is deliberate — a fresh invite, a new password, old links dead", async () => {
  const { business } = await makeOwnedBusiness("back");
  const staff = await invitedAndSet(business.id, "bongani", "bongani-password-1");
  await setStaffActive(business.id, staff.id, false);

  const { token } = await reactivateStaff(business.id, staff.id);
  assert.equal(signedIn(await staffLogin(business.slug, staff.email, "bongani-password-1")), false, "the old password still doesn't work");
  await completeStaffSetPassword(token, "bongani-password-2");
  assert.equal(signedIn(await staffLogin(business.slug, staff.email, "bongani-password-2")), true);
  await assert.rejects(completeStaffSetPassword(token, "again-password-3"), /expired/, "one link, one password");
});

test("B4: one link sets one password, even when used twice at once", async () => {
  const { business } = await makeOwnedBusiness("race");
  const { staff, token } = await inviteStaff(business.id, { firstName: "Race", lastName: "Staff", email: `race-${run}@example.test`, preset: "COUNTER" });
  const results = await Promise.allSettled([completeStaffSetPassword(token, "first-password-1"), completeStaffSetPassword(token, "second-password-2")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(staff.id);
});

test("B4: a session presented against another business is refused", async () => {
  const { business: a } = await makeOwnedBusiness("tena");
  const { business: b } = await makeOwnedBusiness("tenb");
  const staff = await invitedAndSet(a.id, "cross", "cross-password-1");
  await assert.rejects(assertSessionStillActive({ staffId: staff.id, tenantId: b.id, isOwner: false }), AuthError);
});

// ---------------------------------------------------------------------------
// B11 — the stored WhatsApp number is always the international form
// ---------------------------------------------------------------------------

test("B11: saving a WhatsApp number stores +27…; junk is refused in plain words; empty clears", async () => {
  const { business } = await makeOwnedBusiness("wa");
  await updateBusiness(business.id, { whatsapp: "082 123 4567" });
  assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).whatsapp, "+27821234567");
  await assert.rejects(updateBusiness(business.id, { whatsapp: "12345" }), new RegExp(WHATSAPP_FORMAT_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).whatsapp, "+27821234567", "a refused save changes nothing");
  await updateBusiness(business.id, { whatsapp: "" });
  assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).whatsapp, null);
});
