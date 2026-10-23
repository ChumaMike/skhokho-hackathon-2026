"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireDriverSession, AuthError } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import {
  acceptDriverLegal,
  DriverError,
  grantLocationConsent,
  reissueEmailVerification,
  setDriverPayout,
  setDriverVehicle,
  submitDriverApplication,
  updateDriverProfile,
} from "@/modules/skhokholetha/driver.service";
import { sendEmail, driverVerifyEmail } from "@/lib/email";
import { clientIp } from "@/lib/rate-limit";
import { FeatureDisabledError } from "@/modules/skhokholetha/flags";
import { getAppUrl } from "@/lib/utils";
import { headers } from "next/headers";

/** Every onboarding step: the driver's own session, the service's own checks, plain-words errors. */
async function step(fn: (driverId: string) => Promise<unknown>, okFlag: string) {
  let driverId: string;
  try {
    driverId = (await requireDriverSession()).driverId;
  } catch (e) {
    if (e instanceof AuthError) redirect("/driver/login");
    throw e;
  }
  try {
    await fn(driverId);
  } catch (e) {
    const message =
      e instanceof DriverError || e instanceof FeatureDisabledError
        ? e.message
        : e instanceof ZodError
          ? e.issues[0]?.message ?? "Some details were not valid."
          : "Something went wrong. Try again.";
    if (!(e instanceof DriverError) && !(e instanceof ZodError) && !(e instanceof FeatureDisabledError)) console.error("[driver onboarding]", e instanceof Error ? e.message : e);
    redirect(`/driver?err=${encodeURIComponent(message)}`);
  }
  revalidatePath("/driver");
  redirect(`/driver?ok=${okFlag}`);
}

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveProfile(fd: FormData) {
  await step((id) => updateDriverProfile(id, { displayName: text(fd, "displayName"), phone: text(fd, "phone") }), "profile");
}

export async function saveVehicle(fd: FormData) {
  await step(
    (id) => setDriverVehicle(id, { type: text(fd, "type"), registration: text(fd, "registration") || undefined, makeModel: text(fd, "makeModel") || undefined }),
    "vehicle",
  );
}

export async function savePayout(fd: FormData) {
  await step(
    (id) => setDriverPayout(id, { bankName: text(fd, "bankName"), accountHolder: text(fd, "accountHolder"), branchCode: text(fd, "branchCode"), accountNumber: text(fd, "accountNumber").replace(/\s+/g, "") }),
    "payout",
  );
}

/**
 * The form carries the versions the driver was SHOWN; the service accepts only
 * if those are still the configured versions. IP is stored hashed.
 */
export async function acceptAgreement(fd: FormData) {
  if (fd.get("agree") !== "on") redirect(`/driver?err=${encodeURIComponent("Tick the box to accept the terms and privacy notice.")}`);
  const h = await headers();
  await step(
    (id) =>
      acceptDriverLegal(
        id,
        { termsVersion: text(fd, "termsVersion"), privacyVersion: text(fd, "privacyVersion") },
        { ip: clientIp(h), userAgent: h.get("user-agent") },
      ),
    "agreement",
  );
}

export async function allowLocation() {
  await step((id) => grantLocationConsent(id), "consent");
}

export async function submitApplication() {
  await step((id) => submitDriverApplication(id), "submitted");
}

export async function resendVerification() {
  await step(async (id) => {
    const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { id }, select: { user: { select: { email: true, emailVerifiedAt: true } } } });
    if (profile.user.emailVerifiedAt) return;
    const token = await reissueEmailVerification(id);
    const h = await headers();
    const verifyUrl = `${getAppUrl(`${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`)}/api/driver/verify-email?token=${token}`;
    const { subject, html, text: body } = driverVerifyEmail({ verifyUrl });
    await sendEmail({ to: profile.user.email, subject, html, text: body, kind: "driver_verify" });
  }, "verify-sent");
}
