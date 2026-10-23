import AuthShell from "@/components/AuthShell";
import PasswordField from "@/components/PasswordField";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const token = sp.token ?? "";

  return (
    <AuthShell title="Set a new password" subtitle="Choose a password of at least 8 characters.">
      {sp.err && <div className="errorBanner">{sp.err}</div>}

      {!token ? (
        <div className="errorBanner">
          That reset link is missing a token. Request a new one from the
          login page.
        </div>
      ) : (
        <form method="post" action="/api/platform/reset-password">
          <input type="hidden" name="token" value={token} />
          <PasswordField
            id="password"
            name="password"
            label="New password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <button type="submit" className="btn btnPrimary btnBlock">
            Set new password
          </button>
        </form>
      )}
    </AuthShell>
  );
}
