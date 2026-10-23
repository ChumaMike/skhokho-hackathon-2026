import type { Metadata } from "next";
import { getStorefrontTemplateSelection } from "@/modules/tenant/tenant.service";
import { resolveStorefrontTemplate } from "@/modules/tenant/storefront-templates";
import StorefrontHome from "@/components/storefront/StorefrontHome";
import { PreviewBanner, loadPreview } from "./preview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Storefront preview",
  robots: { index: false, follow: false },
};

/**
 * A storefront revision's HOME rendered through the SAME renderer the live
 * store uses (StorefrontHome), with the revision's spec applied to an
 * in-memory copy of the business — nothing is written. Framed by the
 * dashboard at phone and desktop widths (next.config.ts allows same-origin
 * framing for this path only). Nav links stay inside the preview (see
 * preview.tsx) so the owner can browse every page of the draft; the
 * sibling [...rest] route renders those pages.
 *
 * Outside /dashboard on purpose: the dashboard layout adds the Buddy dock,
 * which would sit on top of the storefront being previewed.
 */
export default async function StorefrontRevisionPreview({ params }: { params: Promise<{ revisionId: string }> }) {
  const { revisionId } = await params;
  const { revision, business, previewBusiness, catalog, rating, reviews, basePath, site } = await loadPreview(revisionId);
  const templateSelection = await getStorefrontTemplateSelection(business.id);

  return (
    <>
      <PreviewBanner revision={revision} liveHref={`/store/${business.slug}`} />
      <StorefrontHome
        business={previewBusiness}
        catalog={catalog}
        rating={rating}
        reviews={reviews}
        basePath={basePath}
        navPages={resolveStorefrontTemplate(templateSelection).pages}
        site={site}
      />
    </>
  );
}
