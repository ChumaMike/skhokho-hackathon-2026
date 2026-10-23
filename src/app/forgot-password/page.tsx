import Link from "next/link";
import AuthShell from "@/components/AuthShell";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; unavailable?: string }>;
}) {
  const sp = await searchParams;

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you registered with — we'll send you a link to set a new password."
      footer={<Link href="/login">Back to log in</Link>}
    >
      {sp.unavailable === "1" ? (
        <div className="errorBanner">
          Password reset by email isn&apos;t available right now. Please
          contact support to regain access to your account.
        </div>
      ) : sp.sent === "1" ? (
        <div className="successBanner">
          If that email is registered, a reset link is on its way. Check
          your inbox.
        </div>
      ) : (
        <form method="post" action="/api/platform/forgot-password">
          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              className="input"
              id="email"
              name="email"
              type="email"
              placeholder="you@business.co.za"
              autoComplete="username"
              required
            />
          </div>
          <button type="submit" className="btn btnPrimary btnBlock">
            Send reset link
          </button>
        </form>
      )}
    </AuthShell>
  );
}
