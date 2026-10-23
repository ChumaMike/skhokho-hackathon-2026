import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import PasswordField from "@/components/PasswordField";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; reset?: string }>;
}) {
  const sp = await searchParams;

  return (
    <AuthShell
      title="Log in"
      subtitle="See who's been in and give them a stamp."
      footer={
        <>
          <Link href="/forgot-password">Forgot your password?</Link>
          <span>New here? <Link href="/join">Register your business</Link></span>
          <span>Part of a team? <Link href="/staff-login">Team log in</Link></span>
        </>
      }
    >
      {sp.reset === "1" && (
        <div className="successBanner">
          Password updated. Log in with your new password.
        </div>
      )}
      {sp.err && <div className="errorBanner">{sp.err}</div>}

      <form method="post" action="/api/platform/login">
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
        <PasswordField
          id="password"
          name="password"
          label="Password"
          placeholder="Your password"
          autoComplete="current-password"
          minLength={8}
          required
        />
        <button type="submit" className="btn btnPrimary btnBlock">
          Log in
        </button>
      </form>
    </AuthShell>
  );
}
