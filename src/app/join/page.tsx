import AuthShell from "@/components/AuthShell";
import PasswordField from "@/components/PasswordField";
import { BUSINESS_CATEGORIES as CATEGORIES } from "@/lib/business-categories";
import styles from "./join.module.css";
import HoneypotField from "@/components/HoneypotField";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; category?: string }>;
}) {
  const sp = await searchParams;
  // Prefill from the homepage's "pick your business" selector — validated
  // against the real enum, not trusted as-is (it's a query param).
  const prefillCategory = CATEGORIES.some(([id]) => id === sp.category) ? sp.category : "";

  return (
    <AuthShell
      title="Get your business online"
      subtitle="Register your shop and start tracking your customers & loyalty. Takes a minute."
      footer={<p className={styles.footer}>Powered by Skhokho</p>}
    >
      <form method="post" action="/api/platform/join">
        <HoneypotField />
        {sp.err && <div className="errorBanner">{sp.err}</div>}

        <div className="field">
          <label className="label" htmlFor="name">
            Business name
          </label>
          <input
            className="input"
            id="name"
            name="name"
            placeholder="e.g. Beauty by Nomsa"
            required
            minLength={2}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="category">
            What kind of business?
          </label>
          <select
            className="input"
            id="category"
            name="category"
            required
            defaultValue={prefillCategory}
          >
            <option value="" disabled>
              Choose…
            </option>
            {CATEGORIES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="description">
            What do you do? <span className={styles.optional}>(optional)</span>
          </label>
          <textarea
            className="input"
            id="description"
            name="description"
            placeholder="e.g. Hand-braided hairstyles, home visits available"
            rows={2}
          />
        </div>

        <div className={styles.nameRow}>
          <div className="field">
            <label className="label" htmlFor="firstName">
              First name
            </label>
            <input
              className="input"
              id="firstName"
              name="firstName"
              placeholder="First name"
              required
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="lastName">
              Last name
            </label>
            <input
              className="input"
              id="lastName"
              name="lastName"
              placeholder="Last name"
              required
            />
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="email">
            Email (your login)
          </label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            placeholder="you@business.co.za"
            required
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="phone">
            WhatsApp number
          </label>
          <input
            className="input"
            id="phone"
            name="phone"
            inputMode="tel"
            placeholder="082 123 4567"
          />
        </div>

        <PasswordField
          id="password"
          name="password"
          label="Create a password"
          placeholder="At least 8 characters"
          required
          minLength={8}
          autoComplete="new-password"
        />

        <button type="submit" className="btn btnPrimary btnBlock">
          Create my business
        </button>
      </form>
    </AuthShell>
  );
}
