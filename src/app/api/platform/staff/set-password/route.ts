import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/utils";
import { signToken, sessionCookieOptions, COOKIE_NAME } from "@/modules/auth/auth.service";
import { completeStaffSetPassword } from "@/modules/staff/staff.service";
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Completes a staff invite (or a self-service reinvite) and signs them straight in. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const token = (form.get("token") ?? "").toString();
  const password = (form.get("password") ?? "").toString();
  const origin = getAppUrl(new URL(req.url).origin);

  const back = (err: string) =>
    NextResponse.redirect(
      `${origin}/staff/set-password?token=${encodeURIComponent(token)}&err=${encodeURIComponent(err)}`,
      303,
    );

  if (!token) return back("That invite link is invalid.");

  const limited = await checkRateLimits([["tokenUseIp", clientIp(req)]]);
  if (!limited.allowed) return back(RATE_LIMITED_MESSAGE);

  let staff;
  try {
    staff = await completeStaffSetPassword(token, password);
  } catch (e) {
    return back(e instanceof Error ? e.message : "Could not set your password.");
  }

  const jwt = await signToken({
    type: "staff",
    staffId: staff.id,
    tenantId: staff.businessId,
    email: staff.email,
    isOwner: staff.isOwner,
  });

  const res = NextResponse.redirect(`${origin}/dashboard`, 303);
  res.cookies.set(COOKIE_NAME.staff, jwt, sessionCookieOptions("staff"));
  return res;
}
