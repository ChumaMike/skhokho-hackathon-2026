import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import { prisma } from "@/lib/prisma/client";
import { verifyToken, COOKIE_NAME } from "@/modules/auth/auth.service";
import MfaForm from "./MfaForm";

export const dynamic = "force-dynamic";

/**
 * Admin sign-in, step 2: set up (first time) or enter the authenticator code.
 * Only reachable with the short-lived password-verified cookie.
 */
export default async function AdminMfaPage() {
  const raw = (await cookies()).get(COOKIE_NAME.admin_mfa)?.value;
  let adminId: string | null = null;
  try {
    const t = raw ? await verifyToken(raw) : null;
    if (t?.type === "admin_mfa") adminId = t.adminId;
  } catch {
    adminId = null;
  }
  if (!adminId) redirect("/admin-login");
  const admin = await prisma.platformAdmin.findUnique({ where: { userId: adminId }, select: { mfaEnabledAt: true } });
  if (!admin) redirect("/admin-login");

  return (
    <AuthShell
      title={admin.mfaEnabledAt ? "Enter your code" : "Set up two-step sign-in"}
      subtitle={admin.mfaEnabledAt ? "Open your authenticator app." : "Platform admin accounts need an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…)."}
    >
      <MfaForm mode={admin.mfaEnabledAt ? "verify" : "enroll"} />
    </AuthShell>
  );
}
