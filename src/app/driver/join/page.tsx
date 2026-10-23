import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import PasswordField from "@/components/PasswordField";
import HoneypotField from "@/components/HoneypotField";
import { lethaEnabled } from "@/modules/skhokholetha/flags";

export const dynamic = "force-dynamic";

/** Sign up to drive with Skhokholetha — a new Skhokho account, or add driving to an existing owner account. */
export default async function DriverJoinPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthShell
      title="Drive with Skhokholetha"
      subtitle="Deliver for local shops near you. Earn per delivery, choose when you work."
      footer={
        <>
          <span>Already driving? <Link href="/driver/login">Log in</Link></span>
        </>
      }
    >
      {sp.err && <div className="errorBanner">{sp.err}</div>}
      {/* Display only — the signup and become routes refuse on the server too. */}
      {!lethaEnabled("driverSignup") ? (
        <p>Driver sign-ups aren&apos;t open yet. Please check back soon.</p>
      ) : (
      <>
      <form method="post" action="/api/driver/signup">
        <HoneypotField />
        <div className="field">
          <label className="label" htmlFor="firstName">First name</label>
          <input className="input" id="firstName" name="firstName" autoComplete="given-name" required maxLength={60} />
        </div>
        <div className="field">
          <label className="label" htmlFor="lastName">Surname</label>
          <input className="input" id="lastName" name="lastName" autoComplete="family-name" required maxLength={60} />
        </div>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="phone">Cellphone</label>
          <input className="input" id="phone" name="phone" type="tel" inputMode="tel" placeholder="082 123 4567" autoComplete="tel" required />
        </div>
        <PasswordField id="password" name="password" label="Password" placeholder="At least 8 characters" autoComplete="new-password" minLength={8} required />
        <button type="submit" className="btn btnPrimary btnBlock">Create my driver account</button>
      </form>

      <details style={{ marginTop: 24 }}>
        <summary>Already run a business on Skhokho?</summary>
        <p>Log in to your business first, then add driving to the same account:</p>
        <form method="post" action="/api/driver/become">
          <div className="field">
            <label className="label" htmlFor="displayName">Your name (as on your ID)</label>
            <input className="input" id="displayName" name="displayName" required maxLength={120} />
          </div>
          <div className="field">
            <label className="label" htmlFor="ownerPhone">Cellphone</label>
            <input className="input" id="ownerPhone" name="phone" type="tel" inputMode="tel" required />
          </div>
          <button type="submit" className="btn btnBlock">Add driving to my account</button>
        </form>
      </details>
      </>
      )}
    </AuthShell>
  );
}
