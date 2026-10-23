import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { checkRateLimits, clientIp } from "@/lib/rate-limit";
import { getCustomerDeliveryView } from "@/modules/skhokholetha/delivery.service";
import DeliveryStatusCard, { REFRESHING_STATUSES } from "../../track/DeliveryStatusCard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your delivery",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The CUSTOMER's own delivery page, opened with the key only the customer was
 * given at checkout (never the shop). The only place the drop-off code is
 * shown — so a delivery can't be completed without the customer.
 */
export default async function CustomerDeliveryPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const limited = await checkRateLimits([["trackingIp", clientIp(await headers())]]);
  if (!limited.allowed) {
    return (
      <main className="shell"><div className="column"><div className="card"><p>Too many refreshes — wait a minute and try again.</p></div></div></main>
    );
  }
  const view = await getCustomerDeliveryView(key);
  if (!view) notFound();
  const d = view.delivery;

  return (
    <main className="shell">
      {(!d || REFRESHING_STATUSES.includes(d.status)) && <meta httpEquiv="refresh" content="30" />}
      <div className="column">
        <span className="eyebrow">{view.shopName} · order {view.orderNumber}</span>
        <h1>Your delivery</h1>
        {!d && view.ownDelivery ? (
          <OwnDriverCard shopName={view.shopName} own={view.ownDelivery} />
        ) : !d ? (
          <div className="card">
            <p style={{ margin: 0 }}>The shop is getting your order ready. Keep this page — your delivery code will appear here once a driver is on the way.</p>
          </div>
        ) : (
          <DeliveryStatusCard view={d} />
        )}
        {d?.dropoffCode && (
          <div className="card" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>When your driver arrives, give them this code:</p>
            <p style={{ fontSize: "2rem", letterSpacing: 6, fontWeight: 700, margin: "8px 0" }}>{d.dropoffCode}</p>
            <p style={{ margin: 0 }}>Only share it once your order is in your hands. The shop never sees this code.</p>
            {d.dropoffCodeLocked && <p className="errorBanner">Too many wrong codes were tried. Ask the shop to issue a new code — it will appear here.</p>}
          </div>
        )}
      </div>
    </main>
  );
}

const OWN_STATUS_COPY: Record<string, string> = {
  UNASSIGNED: "The shop is getting your order ready.",
  ASSIGNED: "A driver from the shop has your order and will be on the way soon.",
  PICKED_UP: "Your order is on its way with the shop's driver.",
  DELIVERED: "Delivered — enjoy!",
  FAILED: "There was a problem with this delivery. The shop will be in touch.",
};

/**
 * The shop's OWN driver (not Skhokholetha): the same drop-off code rule —
 * shown here only, given to the driver only once the order is in hand.
 */
function OwnDriverCard({ shopName, own }: { shopName: string; own: { status: string; dropoffCode: string | null; dropoffCodeLocked: boolean } }) {
  return (
    <>
      <div className="card">
        <p style={{ margin: 0 }}>{OWN_STATUS_COPY[own.status] ?? OWN_STATUS_COPY.UNASSIGNED}</p>
      </div>
      {own.dropoffCode && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ margin: 0 }}>When the driver from {shopName} arrives, give them this code:</p>
          <p style={{ fontSize: "2rem", letterSpacing: 6, fontWeight: 700, margin: "8px 0" }}>{own.dropoffCode}</p>
          <p style={{ margin: 0 }}>Only share it once your order is in your hands.</p>
          {own.dropoffCodeLocked && <p className="errorBanner">Too many wrong codes were tried. Ask the shop to issue a new code — it will appear here.</p>}
        </div>
      )}
    </>
  );
}
