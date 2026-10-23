import Link from "next/link";
import { getCustomerSession } from "@/lib/auth/guards";
import { findMembershipForSession, getRewardsCard } from "@/modules/customers/customer-account.service";
import JoinRewardsButton from "./JoinRewardsButton";
import styles from "./Account.module.css";

/**
 * The customer's rewards card at ONE shop — Consent 1 only, nothing across
 * businesses. An async server component that reads the customer session
 * itself, so it can sit on any storefront page in one line:
 *
 *   <RewardsCard business={{ id, name }} basePath={basePath} />
 *
 * Signed out → an invitation to sign in. Signed in, no card here → the
 * Consent 1 wording and a join button. Member → stamps on the current card
 * and the short code to read out at the counter. `compact` drops the
 * explanatory copy for a strip on the confirmation page.
 */
export default async function RewardsCard({
  business,
  basePath,
  compact = false,
}: {
  business: { id: string; name: string };
  basePath: string;
  compact?: boolean;
}) {
  const session = await getCustomerSession();
  if (!session) {
    if (compact) return null;
    return (
      <div className={styles.card}>
        <p className={styles.lede}>Rewards at {business.name}</p>
        <p className={styles.muted}>Sign in with your phone number to see your stamps or start a rewards card here.</p>
        <Link href={`${basePath}/account/login?returnTo=${encodeURIComponent(`${basePath}/account`)}`} className="btn btnSecondary">
          Sign in
        </Link>
      </div>
    );
  }

  const membership = await findMembershipForSession(business.id, session);
  if (!membership) {
    if (session.channel !== "phone") {
      if (compact) return null;
      return (
        <div className={styles.card}>
          <p className={styles.lede}>Rewards at {business.name}</p>
          <p className={styles.muted}>Rewards cards are kept against a phone number. Sign in with your number to start one here.</p>
        </div>
      );
    }
    return (
      <div className={styles.card}>
        <p className={styles.lede}>Rewards at {business.name}</p>
        <JoinRewardsButton businessId={business.id} businessName={business.name} />
      </div>
    );
  }

  const card = await getRewardsCard(business.id, membership);
  return (
    <div className={styles.card} aria-label={`Your rewards card at ${business.name}`}>
      <div className={styles.orderHead}>
        <span className={styles.lede}>Your rewards at {business.name}</span>
        <span className={`${styles.chip} ${card.rewardReady ? styles.chipLive : ""}`}>
          {card.rewardReady ? "Reward ready!" : `${card.progress} of ${card.required}`}
        </span>
      </div>
      <div className={styles.stamps} role="img" aria-label={`${card.progress} of ${card.required} stamps`}>
        {Array.from({ length: card.required }, (_, i) => (
          <span key={i} className={`${styles.stamp} ${i < card.progress ? styles.stampFilled : ""}`} aria-hidden="true">
            {i < card.progress ? "✓" : ""}
          </span>
        ))}
      </div>
      {card.rewardReady ? (
        <p className={styles.muted}>Your card is full — tell {business.name} next time you&apos;re in and claim your reward.</p>
      ) : (
        <p className={styles.muted}>
          {card.required - card.progress} more {card.required - card.progress === 1 ? "stamp" : "stamps"} to your reward.
          {card.redeems > 0 ? ` You've claimed ${card.redeems} so far.` : ""}
        </p>
      )}
      {!compact && (
        <p className={styles.muted}>
          Your code: <span className={styles.codeBadge}>{card.shortCode}</span>
        </p>
      )}
    </div>
  );
}
