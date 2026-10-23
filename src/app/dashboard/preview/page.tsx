import Link from "next/link";
import { requireOwnerSession } from "../session";
import { getBusinessForPreview } from "@/modules/tenant/tenant.service";
import { getActiveCatalog } from "@/modules/catalog/catalog.service";
import { getRatingSummary, listPublishedReviews } from "@/modules/reviews/review.service";
import StorefrontView from "@/components/StorefrontView";

export const dynamic = "force-dynamic";

/**
 * Owner's own storefront preview — same StorefrontView the real /store/[slug]
 * renders, but reachable regardless of publish status, and scoped to the
 * session's own tenantId only (never a client-supplied id or slug), so
 * previewing never doubles as a second, unguarded storefront route.
 */
export default async function PreviewPage() {
  const session = await requireOwnerSession();
  const business = await getBusinessForPreview(session.tenantId);
  if (!business) {
    return (
      <main className="shell">
        <div className="column">
          <p className="errorBanner">Couldn&apos;t load your business for preview.</p>
        </div>
      </main>
    );
  }

  const [catalog, rating, reviews] = await Promise.all([
    getActiveCatalog(business.id),
    getRatingSummary(business.id),
    listPublishedReviews(business.id),
  ]);

  return (
    <>
      <div className="shell" style={{ paddingBottom: 0 }}>
        <div className="column">
          <div className="errorBanner" style={{ background: "rgba(232,160,32,0.12)", borderColor: "var(--amber)" }}>
            Preview only — this is what customers will see once you publish.{" "}
            <Link href="/dashboard" style={{ color: "inherit", textDecoration: "underline" }}>
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
      <StorefrontView business={business} catalog={catalog} returnTo="/dashboard/preview" rating={rating} reviews={reviews} />
    </>
  );
}
