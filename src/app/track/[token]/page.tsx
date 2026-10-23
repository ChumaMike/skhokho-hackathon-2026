import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { checkRateLimits, clientIp } from "@/lib/rate-limit";
import { getTrackingView } from "@/modules/skhokholetha/delivery.service";
import DeliveryStatusCard, { REFRESHING_STATUSES } from "../DeliveryStatusCard";

export const dynamic = "force-dynamic";

// The token is the only key to this page: keep it out of search engines and
// out of the Referer header sent to any link the visitor follows.
export const metadata: Metadata = {
  title: "Delivery status",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The STATUS link a shop can share. The shop holds this token, so the page
 * shows status, driver first name and a rough ETA only — never the drop-off
 * code (that lives on the customer's own page, /delivery/<customer key>).
 * Unknown and expired links look identical (404).
 */
export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await checkRateLimits([["trackingIp", clientIp(await headers())]]);
  if (!limited.allowed) {
    return (
      <main className="shell"><div className="column"><div className="card"><p>Too many refreshes — wait a minute and try again.</p></div></div></main>
    );
  }
  const view = await getTrackingView(token);
  if (!view) notFound();

  return (
    <main className="shell">
      {REFRESHING_STATUSES.includes(view.status) && <meta httpEquiv="refresh" content="30" />}
      <div className="column">
        <span className="eyebrow">Skhokholetha · {view.shopName}</span>
        <h1>Delivery status</h1>
        <DeliveryStatusCard view={view} />
      </div>
    </main>
  );
}
