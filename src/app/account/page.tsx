import Link from "next/link";
import type { Metadata } from "next";
import { getCustomerSession } from "@/lib/auth/guards";
import { crossBusinessLinkingEnabled } from "@/modules/customers/cross-business";
import { listMembershipsAcrossBusinesses } from "@/modules/customers/customer-account.service";
import { legacyStorefrontPath } from "@/modules/tenant/storefront-url";
import { formatSAPhone } from "@/lib/utils";
import styles from "@/components/storefront/account/Account.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your Skhokho account",
  robots: { index: false, follow: false },
};

/**
 * The platform-host account page — "all my shops in one place". This view
 * links one person across businesses, which is the POPIA s57 layer; it
 * renders only while CROSS_BUSINESS_LINKING_ENABLED is on. Until then it
 * explains that rewards live with each shop and sends the customer to a
 * shop's own page. (On a tenant host /account is that shop's own account
 * page — the middleware rewrites it under the tenant.)
 */
export default async function PlatformAccountPage() {
  const session = await getCustomerSession();

  if (!crossBusinessLinkingEnabled()) {
    return (
      <main className="shell">
        <div className="column">
          <span className="eyebrow">Skhokho</span>
          <h1>Your account</h1>
          <p>Your orders and rewards live with each shop. Open the shop&apos;s page and tap <strong>Account</strong> there to see them.</p>
          <p className={styles.muted}>Seeing all your shops in one place is coming once the regulator clears it.</p>
          <Link href="/discover" className="btn btnSecondary">
            Find a shop
          </Link>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="shell">
        <div className="column">
          <span className="eyebrow">Skhokho</span>
          <h1>Your account</h1>
          <p>Sign in on any shop&apos;s page with your phone number, then come back here to see all your shops.</p>
          <Link href="/discover" className="btn btnSecondary">
            Find a shop
          </Link>
        </div>
      </main>
    );
  }

  const memberships = await listMembershipsAcrossBusinesses(session);
  const who = session.channel === "phone" ? formatSAPhone(session.identifier) : session.identifier;

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1>All your shops</h1>
        <p className={styles.muted}>Signed in as {who}</p>
        {memberships.length === 0 ? (
          <p>No rewards cards yet. Order from a shop or start a card on its page.</p>
        ) : (
          <ul className={styles.orderList}>
            {memberships.map((m) => {
              const progress = Math.min(m.required, Math.max(0, m.stamps - m.redeems * m.required));
              return (
                <li key={m.publicId} className={styles.card}>
                  <div className={styles.orderHead}>
                    <span className={styles.orderNumber}>{m.businessName}</span>
                    <span className={styles.chip}>
                      {progress} of {m.required}
                    </span>
                  </div>
                  <p className={styles.muted}>
                    Your code here: <strong>{m.shortCode}</strong>
                  </p>
                  <div className={styles.actions}>
                    <Link href={`${legacyStorefrontPath(m.businessSlug)}/account`} className="btn btnSecondary">
                      Orders and rewards at {m.businessName}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
