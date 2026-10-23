import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma/client";
import { storefrontBasePath } from "@/lib/tenant/storefront-request";
import StorefrontBeacon from "@/components/storefront/StorefrontBeacon";
import PushServiceWorker from "@/components/storefront/push/PushServiceWorker";
import { isWebPushConfigured } from "@/lib/messaging/webpush-config";
import { StorefrontShareProvider } from "@/components/storefront/share/StorefrontShareContext";
import { canonicalStorefrontUrl } from "@/modules/tenant/storefront-url";

/**
 * Every live storefront page gets the privacy-aware analytics beacon (see
 * StorefrontBeacon). The merchant's preview renders outside this route, so
 * previews are never counted. Pages keep doing their own business lookup and
 * 404 handling; this only adds the beacon when the business is live.
 *
 * It also registers the Web Push service worker (push only, no caching)
 * when the deployment has VAPID keys — registration asks nothing; the
 * permission question is PushPrompt's, after an order or a sign-in.
 *
 * And it tells every Share button (social products, Tab 7) which shop this
 * is and the canonical address shares should carry — once, here, so no
 * product card needs to know.
 */
export default async function StoreLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await prisma.business.findFirst({
    where: { slug, status: "ACTIVE" },
    select: {
      id: true,
      slug: true,
      name: true,
      // The live primary custom domain, for canonical share links (same rule as getBusinessBySlug).
      domains: { where: { surface: "STOREFRONT", isPrimary: true, status: "ACTIVE" }, select: { hostname: true }, take: 1 },
    },
  });
  const content = business ? (
    <StorefrontShareProvider value={{ businessId: business.id, businessName: business.name, origin: canonicalStorefrontUrl(business.slug, "", business.domains[0]?.hostname) }}>
      {children}
    </StorefrontShareProvider>
  ) : (
    children
  );
  return (
    <>
      {content}
      {business && <StorefrontBeacon businessId={business.id} basePath={await storefrontBasePath(business.slug)} />}
      {business && <PushServiceWorker enabled={isWebPushConfigured()} />}
    </>
  );
}
