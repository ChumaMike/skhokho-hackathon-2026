import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import PasswordField from "@/components/PasswordField";

export const dynamic = "force-dynamic";

export default async function DriverLoginPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthShell
      title="Driver log in"
      subtitle="Skhokholetha deliveries."
      footer={
        <>
          <Link href="/forgot-password">Forgot your password?</Link>
          <span>New driver? <Link href="/driver/join">Sign up to drive</Link></span>
        </>
      }
    >
      {sp.err && <div className="errorBanner">{sp.err}</div>}
      <form method="post" action="/api/driver/login">
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <PasswordField id="password" name="password" label="Password" placeholder="Your password" autoComplete="current-password" minLength={8} required />
        <button type="submit" className="btn btnPrimary btnBlock">Log in</button>
      </form>
    </AuthShell>
  );
}
