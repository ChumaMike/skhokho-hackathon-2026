import AuthShell from "@/components/AuthShell";
import PasswordField from "@/components/PasswordField";

export const dynamic = "force-dynamic";

export default async function StaffSetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const token = sp.token ?? "";

  return (
    <AuthShell title="Set your password" subtitle="Choose a password of at least 8 characters to finish joining the team.">
      {sp.err && <div className="errorBanner">{sp.err}</div>}

      {!token ? (
        <div className="errorBanner">
          That invite link is missing a token. Ask the business to resend it.
        </div>
      ) : (
        <form method="post" action="/api/platform/staff/set-password">
          <input type="hidden" name="token" value={token} />
          <PasswordField
            id="password"
            name="password"
            label="Password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <button type="submit" className="btn btnPrimary btnBlock">
            Set password and log in
          </button>
        </form>
      )}
    </AuthShell>
  );
}
