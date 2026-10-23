import { notFound } from "next/navigation";
import { requireStaffPermission } from "@/lib/auth/guards";
import { getBusinessForPreview } from "@/modules/tenant/tenant.service";
import { getActiveCatalog } from "@/modules/catalog/catalog.service";
import { getRatingSummary, listPublishedReviews } from "@/modules/reviews/review.service";
import { getRevision, type RevisionView } from "@/modules/storefront-spec/revision.service";
import { withSpecApplied } from "@/modules/storefront-spec/project";
import { loadSite, type ResolvedSite } from "@/modules/storefront-spec/site";

/** The preview's own address for a draft — nav links inside the preview stay inside it, so the owner can browse the whole draft. */
export function previewBasePath(revisionId: string): string {
  return `/preview/storefront/${revisionId}`;
}

/**
 * Everything a preview page needs: the merchant's own business (the
 * session's, with canManageSettings — anything else is a 404), the
 * revision, an in-memory copy of the business with the draft applied, the
 * live catalogue and reviews, and the draft's pages resolved against the
 * preview's own base path. Nothing is written.
 */
export async function loadPreview(revisionId: string) {
  let tenantId: string | null = null;
  try {
    tenantId = (await requireStaffPermission("canManageSettings")).payload.tenantId;
  } catch {
    tenantId = null;
  }
  if (!tenantId) notFound();

  const [revision, business] = await Promise.all([getRevision(tenantId, revisionId), getBusinessForPreview(tenantId)]);
  if (!revision || !business) notFound();

  const previewBusiness = withSpecApplied(business, revision.spec, revision.id);
  const [catalog, rating, reviews] = await Promise.all([getActiveCatalog(business.id), getRatingSummary(business.id), listPublishedReviews(business.id, { limit: 50 })]);
  const basePath = previewBasePath(revision.id);
  const site: ResolvedSite = await loadSite(previewBusiness, basePath, { catalog, reviewCount: rating.count });
  return { revision, business, previewBusiness, catalog, rating, reviews, basePath, site };
}

/** The sticky "this is a preview" line at the top of every preview page. */
export function PreviewBanner({ revision, liveHref }: { revision: Pick<RevisionView, "version" | "status">; liveHref: string }) {
  return (
    <div
      role="status"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        padding: "6px 12px",
        fontSize: 13,
        textAlign: "center",
        background: "#23201B",
        color: "#F8F5EE",
      }}
    >
      Preview of draft v{revision.version} — {revision.status === "PUBLISHED" ? "this is live" : "not live yet"}. Pages here show the draft;{" "}
      <a href={liveHref} style={{ color: "#F8F5EE", textDecoration: "underline" }}>
        open your live store
      </a>
      .
    </div>
  );
}
