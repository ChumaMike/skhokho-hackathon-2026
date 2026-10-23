import type { CSSProperties, ReactNode } from "react";
import type { StorefrontPageId } from "@/modules/tenant/storefront-templates";
import viewStyles from "@/components/StorefrontView.module.css";
import StorefrontFooter from "./StorefrontFooter";
import type { EctaSourceBusiness } from "@/modules/tenant/legal-information";
import StorefrontNav from "./StorefrontNav";

/**
 * The same `--store-*`-scoped wrapper StorefrontView renders around the
 * home page — extracted so the new /about, /gallery, /contact pages get
 * identical theming without duplicating that markup three times. Does NOT
 * touch StorefrontView itself, which keeps rendering its own copy: the home
 * route is live for every real business today, and this milestone's new
 * routes are 404 until a template actually includes them (see
 * resolveStorefrontTemplate) — zero reason to risk the proven path to share
 * three lines of JSX with routes nothing can reach yet.
 *
 * `footerBusiness` is optional (not every call site has fetched a business
 * row yet when this was first written) but every real caller today passes
 * it, so every non-home storefront page gets the same closing footer HOME
 * already has. `nav`/`basePath` are the same story for StorefrontNav —
 * optional so nothing breaks if a caller hasn't resolved the template's
 * page list, but every real caller passes it.
 */
export default function StorefrontPageShell({
  tokens,
  footerBusiness,
  nav,
  basePath,
  children,
}: {
  tokens: Record<string, string>;
  footerBusiness?: EctaSourceBusiness;
  nav?: StorefrontPageId[];
  basePath?: string;
  children: ReactNode;
}) {
  return (
    <main className="shell">
      <div className={`column wide ${viewStyles.themeScope}`} style={tokens as CSSProperties}>
        {nav && <StorefrontNav basePath={basePath ?? ""} pages={nav} />}
        {children}
        {footerBusiness && <StorefrontFooter business={footerBusiness} />}
      </div>
    </main>
  );
}
