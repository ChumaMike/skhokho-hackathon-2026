import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma/client";
import { formatZAR } from "@/lib/utils";
import OrderTrackingMap from "@/components/tracking/OrderTrackingMap";
import CustomerDeliveryLink from "@/components/storefront/CustomerDeliveryLink";
import RewardsCard from "@/components/storefront/account/RewardsCard";
import PushPrompt from "@/components/storefront/push/PushPrompt";
import PushServiceWorker from "@/components/storefront/push/PushServiceWorker";
import { webPushPublicKey } from "@/lib/messaging/webpush-config";
import { basePathFor, orderVisibleOnRequest, requestTenant } from "@/lib/tenant/storefront-request";
import { orderEta, readPrepMinutes } from "@/modules/customers/order-confirmation";
import styles from "@/components/storefront/account/Account.module.css";

export const dynamic = "force-dynamic";

// An order page is keyed by its unguessable id and is nobody's search result.
export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Sent to the shop",
  CONFIRMED: "Confirmed",
  PROCESSING: "Being prepared",
  READY: "Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

const LIVE = ["PENDING", "CONFIRMED", "PROCESSING", "READY"];

const PLACED_FORMAT = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function paymentLine(o: { paymentStatus: string; paymentMethod: string | null; fulfilmentMethod: string; status: string }): string {
  if (o.paymentStatus === "PAID") return "Paid";
  if (o.paymentStatus === "REFUNDED") return "Refunded";
  if (o.status === "CANCELLED") return "Nothing to pay";
  if (o.paymentMethod === "CASH") return o.fulfilmentMethod === "DELIVERY" ? "Pay the driver when it arrives" : "Pay when you collect";
  return "Payment pending";
}

/**
 * The order confirmation and tracking page — reached straight after an
 * in-person checkout, from the confirmation text/email, and from the
 * customer's account. Same "unguessable link" trust model as
 * /store/pay/[orderId] (the order id itself is the key). On a tenant host
 * only that tenant's own orders are visible. Everything shown comes from
 * the order; `?placed=1` only switches on the thank-you banner.
 */
export default async function OrderConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ placed?: string }>;
}) {
  const { orderId } = await params;
  const sp = await searchParams;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      businessId: true,
      status: true,
      createdAt: true,
      total: true,
      fulfilmentMethod: true,
      paymentStatus: true,
      paymentMethod: true,
      business: { select: { slug: true, name: true, phone: true, whatsapp: true, settings: true } },
      items: { orderBy: { id: "asc" }, select: { name: true, quantity: true, options: { orderBy: { sortOrder: "asc" }, select: { optionNameSnapshot: true } } } },
      delivery: { select: { status: true, deliveredAt: true, failureReason: true } },
    },
  });
  const tenant = await requestTenant();
  if (!order || !orderVisibleOnRequest(order.businessId, tenant)) notFound();

  const basePath = basePathFor(order.business.slug, tenant);
  const storeUrl = basePath || "/";
  const live = LIVE.includes(order.status);
  const eta = orderEta({ status: order.status, placedAt: order.createdAt, prepMinutes: readPrepMinutes(order.business.settings) });
  const contact = order.business.whatsapp || order.business.phone;
  const deliveryStatus = order.delivery?.status ?? null;

  return (
    <main className="shell">
      {live && <meta httpEquiv="refresh" content="30" />}
      <div className="column">
        <p className="eyebrow">{order.business.name}</p>
        <h1>Order {order.orderNumber}</h1>

        {sp.placed === "1" && (
          <div className="successBanner">
            Thanks — your order is in. Keep this page: it shows your order number and where your order is.
          </div>
        )}
        {/* Web Push: the worker on every visit (it only shows updates), the offer once, right after checkout. The
            order id this browser was just handed is how the subscription finds its membership (push-subscriptions.service). */}
        <PushServiceWorker enabled={webPushPublicKey() !== null} />
        {sp.placed === "1" && (
          <PushPrompt publicKey={webPushPublicKey()} businessId={order.businessId} businessName={order.business.name} trigger="order" orderId={order.id} />
        )}

        <div className={styles.card}>
          <div className={styles.orderHead}>
            <span className={styles.orderNumber}>{order.fulfilmentMethod === "DELIVERY" ? "Delivery" : "Collection"}</span>
            <span className={`${styles.chip} ${live ? styles.chipLive : styles.chipDone}`}>{STATUS_LABEL[order.status] ?? order.status}</span>
          </div>
          <p className={styles.muted}>
            Placed {PLACED_FORMAT.format(order.createdAt)} · {formatZAR(order.total)} · {paymentLine(order)}
          </p>
          {eta && (
            <p className={styles.lede}>
              {eta.state === "ready" ? "Your order is ready." : `Usually ready in ${eta.window}${eta.readyBy ? ` — expect it around ${eta.readyBy}` : ""}.`}
            </p>
          )}
          <ul className={styles.itemLines}>
            {order.items.map((i, idx) => (
              <li key={idx}>
                {i.quantity} × {i.name}
                {i.options.length > 0 ? ` — ${i.options.map((o) => o.optionNameSnapshot).join(", ")}` : ""}
              </li>
            ))}
          </ul>
          {contact && <p className={styles.muted}>Questions? Contact {order.business.name} on {contact}.</p>}
        </div>

        {order.delivery && (
          <div className={styles.card}>
            <p className={styles.lede}>Delivery</p>
            <CustomerDeliveryLink orderId={order.id} />
            {deliveryStatus === "UNASSIGNED" && <p className={styles.muted}>Your order is being prepared — a driver hasn&apos;t been assigned yet.</p>}
            {deliveryStatus === "ASSIGNED" && <p className={styles.muted}>A driver has been assigned and will be on their way soon.</p>}
            {deliveryStatus === "PICKED_UP" && (
              <>
                <p className={styles.muted}>Your driver is on the way — track their position below.</p>
                <OrderTrackingMap orderId={order.id} />
              </>
            )}
            {deliveryStatus === "DELIVERED" && (
              <div className="successBanner">Delivered{order.delivery.deliveredAt ? ` at ${PLACED_FORMAT.format(order.delivery.deliveredAt)}` : ""} — enjoy!</div>
            )}
            {deliveryStatus === "FAILED" && (
              <div className="errorBanner">
                There was a problem with this delivery{order.delivery.failureReason ? `: ${order.delivery.failureReason}` : ""}. The business will be in touch.
              </div>
            )}
          </div>
        )}

        {/* This shop's rewards card only (Consent 1) — a strip when signed in and a member, a join offer when signed in and not, nothing when signed out. */}
        <RewardsCard business={{ id: order.businessId, name: order.business.name }} basePath={basePath} compact />

        <div className={styles.actions}>
          <a className="btn btnPrimary" href={`${basePath}/account`}>
            See all your orders
          </a>
          <a className="btn btnSecondary" href={storeUrl}>
            Back to the shop
          </a>
        </div>
        <p className={styles.muted}>Sign in with the number you used at checkout to see your orders and rewards here.</p>
      </div>
    </main>
  );
}
