import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug } from "@/modules/tenant/tenant.service";
import { getFulfilmentSettings, getOrderingSettings } from "@/modules/tenant/capabilities";
import { getTradingStatus } from "@/modules/tenant/trading-status";
import { getReceivingConnection } from "@/modules/payments/payment-connection.service";
import CheckoutShell from "@/components/storefront/CheckoutShell";
import CheckoutView from "@/components/storefront/CheckoutView";
import { checkoutPaymentOptions } from "@/modules/orders/checkout-payment";
import { formatZAR } from "@/lib/utils";
import { storefrontBasePath } from "@/lib/tenant/storefront-request";

export const dynamic = "force-dynamic";

interface Params {
  slug: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  return { title: business ? `Checkout — ${business.name}` : "Business not found" };
}

/**
 * One streamlined checkout surface — Order / Fulfilment / Details /
 * Consent / Review / Place order, visually grouped on one page (see
 * CheckoutView). Only resolves server-known, non-sensitive context here
 * (which business, which fulfilment methods exist, whether a card is
 * taken) — everything about the actual cart lives client-side until the
 * final submit, and the server re-derives it all in /api/store/checkout.
 */
export default async function CheckoutPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  const basePath = await storefrontBasePath(business.slug);

  const fulfilment = getFulfilmentSettings(business);
  // Same source checkout enforces (trading-status.ts) — an immediate badge
  // independent of the async quote round-trip.
  const trading = getTradingStatus(business);
  const minOrderCents = getOrderingSettings(business).minOrderCents;
  // Whether a card is taken is a server fact: THIS business's own verified
  // LIVE PayFast connection (loaded here, never from the client) and its
  // online-payment setting. The same decision /api/store/checkout makes, so
  // the button never promises a payment step the next screen won't have.
  // Nothing about the connection reaches the client — only the two booleans
  // (card available, in person allowed) that decide what the customer may pick.
  const receiving = await getReceivingConnection(business.id);
  const paymentOptions = checkoutPaymentOptions(business, receiving);

  return (
    <CheckoutShell business={business} basePath={basePath} pageTitle="Checkout" wide>
      <CheckoutView
        businessId={business.id}
        basePath={basePath}
        collectionEnabled={fulfilment.collectionEnabled}
        deliveryEnabled={fulfilment.deliveryEnabled}
        paymentOptions={paymentOptions}
        tradingState={trading.state}
        tradingLabel={trading.label}
        minOrderAmount={minOrderCents > 0 ? formatZAR(minOrderCents / 100) : undefined}
      />
    </CheckoutShell>
  );
}
