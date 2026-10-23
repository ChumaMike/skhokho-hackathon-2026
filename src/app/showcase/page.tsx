import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import ShowcaseCatalog from "./ShowcaseCatalog";
import styles from "./showcase.module.css";
import { toShowcasePlan } from "./data";
import { listPublicPlans } from "@/modules/billing/subscription.service";

// Plans are read from the database on each request, so a packaging or price
// change is a data edit that shows up here without a redeploy.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "What you can get — Skhokho",
  description:
    "Platform plans and hand-built add-on services for South African small businesses.",
};

/**
 * "What a business can get" — two groups per the task spec: the platform
 * plans (the same plans + entitlements the platform enforces, read from
 * the database) and the studio's add-on services (known prices).
 * ShowcaseCatalog is the client boundary that owns the enquiry modal.
 */
export default async function ShowcasePage() {
  const plans = (await listPublicPlans()).map(toShowcasePlan);

  return (
    <main className="shell">
      <div className="column wide">
        <SiteHeader current="showcase" />
        <h1 className={styles.title}>What you can get</h1>
        <p className={styles.lede}>
          Pick a plan or a service below and leave your number. We&apos;ll
          get in touch — nothing is billed from this page.
        </p>

        <ShowcaseCatalog plans={plans} />
      </div>
    </main>
  );
}
