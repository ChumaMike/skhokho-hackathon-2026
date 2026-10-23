import AuthShell from "@/components/AuthShell";
import PasswordField from "@/components/PasswordField";

export const dynamic = "force-dynamic";

/** Skhokho platform staff only. */
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthShell title="Platform admin" subtitle="Skhokho staff only.">
      {sp.err && <div className="errorBanner">{sp.err}</div>}
      <form method="post" action="/api/admin/login">
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
