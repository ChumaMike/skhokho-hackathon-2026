import type { CSSProperties, ReactNode } from "react";
import { resolveShopfrontTokens } from "@/modules/tenant/shopfront-tokens";
import type { ResolvedSite } from "@/modules/storefront-spec/site";
import ShopfrontNav from "./ShopfrontNav";
import ShopfrontFooter from "./ShopfrontFooter";
import EctaInformation from "@/components/storefront/EctaInformation";
import styles from "./Shopfront.module.css";

type ShopfrontFooterBusiness = {
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  suburb: string | null;
  city: string | null;
  /** settings.legal feeds the footer's ECTA block (EctaInformation). */
  settings: unknown;
};

/**
 * The shared theme-token + chrome wrapper every Connected Shopfront page
 * renders inside. One business row covers both the colour tokens and the
 * footer's contact fields; `site` (storefront-spec/site.ts) carries the
 * owner's pages for the nav and footer, so every page shows the same menu.
 */
export default function ShopfrontPageShell({
  business,
  basePath,
  site,
  children,
}: {
  business: ShopfrontFooterBusiness & { id: string; slug: string; primaryColor: string | null; accentColor: string | null };
  basePath: string;
  site: ResolvedSite;
  children: ReactNode;
}) {
  const tokens = resolveShopfrontTokens(business);

  return (
    <main className={styles.scope} style={tokens as CSSProperties}>
      <ShopfrontNav businessId={business.id} businessName={business.name} basePath={basePath} items={site.nav} />
      {children}
      <ShopfrontFooter business={business} links={site.footer} legal={<EctaInformation business={business} tone="dark" />} />
    </main>
  );
}
