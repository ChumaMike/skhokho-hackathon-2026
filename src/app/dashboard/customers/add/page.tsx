import Link from "next/link";
import { requireOwnerSession } from "../../session";
import { addCustomer } from "../actions";
import styles from "./add.module.css";

export const dynamic = "force-dynamic";

export default async function AddCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  await requireOwnerSession();
  const sp = await searchParams;

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Add a customer</h1>
        <p className={styles.sub}>
          Their number starts their card and gives them their first stamp. Name and
          email are optional — email only if you want to send them a confirmation.
        </p>

        {sp.err && <div className="errorBanner">{sp.err}</div>}

        <form action={addCustomer} id="add-customer-form">
          <div className="field">
            <label className="label" htmlFor="name">
              Name (optional)
            </label>
            <input className="input" id="name" name="name" autoComplete="name" placeholder="Their name" />
          </div>
          <div className="field">
            <label className="label" htmlFor="phone">
              Customer&apos;s number
            </label>
            <input
              className="input"
              id="phone"
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder="082 123 4567"
              required
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="email">
              Email (optional)
            </label>
            <input
              className="input"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="Their email"
            />
          </div>
          <label htmlFor="consent" className={styles.consentRow}>
            <input type="checkbox" id="consent" name="consent" required />
            They agree to Skhokho&apos;s <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>
          </label>
          <label htmlFor="consentMarketing" className={styles.consentRow}>
            <input type="checkbox" id="consentMarketing" name="consentMarketing" />
            They&apos;d like offers and news from this business and Skhokho partners
          </label>
        </form>

        <Link href="/dashboard/customers" className={styles.cancel}>
          Cancel
        </Link>
      </div>

      <div className="bottomBar">
        <div className="bottomBarInner">
          <button
            type="submit"
            form="add-customer-form"
            className="btn btnPrimary btnBlock"
          >
            Add &amp; give first stamp
          </button>
        </div>
      </div>
    </main>
  );
}
