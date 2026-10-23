import type { CSSProperties, ReactNode } from "react";
import type { BusinessCategory } from "@prisma/client";
import { resolveShopfrontTokens } from "@/modules/tenant/shopfront-tokens";
import ShopfrontNavCentered from "./ShopfrontNavCentered";
import { resolveHomeLayout } from "@/modules/storefront-spec/layout";
import type { ResolvedSite } from "@/modules/storefront-spec/site";
import ShopfrontFooter from "@/components/storefront/shopfront/ShopfrontFooter";
import EctaInformation from "@/components/storefront/EctaInformation";
import styles from "@/components/storefront/shopfront/Shopfront.module.css";

type ShopfrontFooterBusiness = {
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  suburb: string | null;
  city: string | null;
};

/**
 * The services/booking counterpart to ShopfrontPageShell — same theme-token
 * + footer wrapper, swapping in the centred ShopfrontNavCentered. The nav
 * and footer links come from `site` (the owner's pages), the main action
 * from the published layout.
 */
export default function ShopfrontBookingPageShell({
  business,
  basePath,
  site,
  children,
}: {
  business: ShopfrontFooterBusiness & {
    id: string;
    slug: string;
    primaryColor: string | null;
    accentColor: string | null;
    category: BusinessCategory;
    settings: unknown;
  };
  basePath: string;
  site: ResolvedSite;
  children: ReactNode;
}) {
  const tokens = resolveShopfrontTokens(business);
  const action = resolveHomeLayout(business, site.capabilities, "BOOKING", basePath, {
    label: "Book now",
    href: `${basePath}#services`,
  }).heroAction;

  return (
    <main className={styles.scope} style={tokens as CSSProperties}>
      <ShopfrontNavCentered
        businessId={business.id}
        businessName={business.name}
        basePath={basePath}
        hasShop={site.capabilities.has("PRODUCTS")}
        action={action}
        items={site.nav}
      />
      {children}
      <ShopfrontFooter business={business} links={site.footer} legal={<EctaInformation business={business} tone="dark" />} />
    </main>
  );
}
