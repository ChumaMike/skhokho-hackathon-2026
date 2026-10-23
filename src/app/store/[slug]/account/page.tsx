import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug } from "@/modules/tenant/tenant.service";
import { getCustomerSession } from "@/lib/auth/guards";
import { findMembershipForSession } from "@/modules/customers/customer-account.service";
import { listCustomerOrders } from "@/modules/customers/customer-orders.service";
import { formatSAPhone } from "@/lib/utils";
import CheckoutShell from "@/components/storefront/CheckoutShell";
import SignOutButton from "@/components/storefront/account/SignOutButton";
import OrdersList from "@/components/storefront/account/OrdersList";
import RewardsCard from "@/components/storefront/account/RewardsCard";
import PushPrompt from "@/components/storefront/push/PushPrompt";
import PushSettings from "@/components/storefront/push/PushSettings";
import { listPushDevices } from "@/modules/customers/push-subscriptions.service";
import { webPushPublicKey } from "@/lib/messaging/webpush-config";
import { storefrontBasePath } from "@/lib/tenant/storefront-request";
import styles from "@/components/storefront/account/Account.module.css";

export const dynamic = "force-dynamic";

interface Params {
  slug: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  return { title: business ? `Your account — ${business.name}` : "Business not found", robots: { index: false, follow: false } };
}

/**
 * The customer's account at THIS shop. Signed out it explains and links to
 * sign-in; signed in it resolves the per-business membership from the
 * verified identifier and shows only pairwise facts (short code, this
 * shop's orders) — the global Skhokho id never reaches this page.
 */
export default async function AccountPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  const basePath = await storefrontBasePath(business.slug);
  const session = await getCustomerSession();

  if (!session) {
    return (
      <CheckoutShell business={business} basePath={basePath} pageTitle="Your account">
        <div className={styles.stack}>
          <p className={styles.lede}>Sign in with your phone number to see your orders and rewards at {business.name}.</p>
          <Link href={`${basePath}/account/login`} className="btn btnPrimary">
            Sign in
          </Link>
        </div>
      </CheckoutShell>
    );
  }

  const membership = await findMembershipForSession(business.id, session);
  const orders = membership ? await listCustomerOrders(business.id, membership.membershipId) : [];
  // Web Push: the browsers switched on at this shop, labels only (never endpoints or keys).
  const pushDevices = membership ? await listPushDevices(membership.membershipId) : [];
  const anyLive = orders.some((o) => o.live);
  const who = session.channel === "phone" ? formatSAPhone(session.identifier) : session.identifier;

  return (
    <CheckoutShell business={business} basePath={basePath} pageTitle="Your account">
      {/* Live orders change under the customer; a plain refresh keeps the page honest without any script. */}
      {anyLive && <meta httpEquiv="refresh" content="30" />}
      <div className={styles.stack}>
        <div className={styles.card}>
          <p className={styles.lede}>
            Signed in as <strong>{who}</strong>
          </p>
          {!membership && (
            <p className={styles.muted}>You haven&apos;t ordered or joined rewards at {business.name} yet. Once you do, your orders and rewards card show up here.</p>
          )}
          <SignOutButton returnTo={basePath || "/"} />
        </div>

        {/* Web Push offer, once, only when the login form just signed this browser in (sessionStorage flag). */}
        {membership && <PushPrompt publicKey={webPushPublicKey()} businessId={business.id} businessName={business.name} trigger="signin" />}

        {/* Consent 1 only — this shop's card. Nothing from any other shop appears here. */}
        <RewardsCard business={{ id: business.id, name: business.name }} basePath={basePath} />

        {/* Switch order updates off (this phone, or everywhere here) or on — shown once there is a membership to tie them to. */}
        {membership && <PushSettings publicKey={webPushPublicKey()} businessId={business.id} businessName={business.name} devices={pushDevices} />}

        <section aria-labelledby="your-orders">
          <h3 id="your-orders" className={styles.lede}>
            Your orders
          </h3>
          <OrdersList orders={orders} businessId={business.id} basePath={basePath} />
        </section>
      </div>
    </CheckoutShell>
  );
}
