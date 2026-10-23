import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import PasswordField from "@/components/PasswordField";

export const dynamic = "force-dynamic";

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; business?: string }>;
}) {
  const sp = await searchParams;

  return (
    <AuthShell
      title="Team log in"
      subtitle="For staff added to a business — not the owner login."
      footer={<Link href="/login">Business owner? Log in here instead</Link>}
    >
      {sp.err && <div className="errorBanner">{sp.err}</div>}

      <form method="post" action="/api/platform/staff-login">
        <div className="field">
          <label className="label" htmlFor="business">
            Business
          </label>
          <input
            className="input"
            id="business"
            name="business"
            type="text"
            placeholder="your-business-slug"
            autoComplete="organization"
            defaultValue={sp.business ?? ""}
            required
          />
        </div>
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
