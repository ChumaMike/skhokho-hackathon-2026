import ConnectedShopfrontHomepage from "@/components/marketing/connected-shopfront/ConnectedShopfrontHomepage";

/**
 * The product's front door. Fully static (no request-time data, no database
 * calls), so this renders at build time. See
 * src/components/marketing/connected-shopfront/ConnectedShopfrontHomepage.tsx
 * for the actual page content.
 */
export default function LandingPage() {
  return <ConnectedShopfrontHomepage />;
}
