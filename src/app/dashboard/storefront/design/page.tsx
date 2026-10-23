import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { prisma } from "@/lib/prisma/client";
import { getActiveCatalog } from "@/modules/catalog/catalog.service";
import { getRatingSummary, listPublishedReviews } from "@/modules/reviews/review.service";
import { getStorefrontConfig } from "@/modules/tenant/storefront-theme";
import { getStorefrontContent } from "@/modules/tenant/storefront-content";
import { getStorefrontTemplateSelection } from "@/modules/tenant/tenant.service";
import {
  isValidTemplateId,
  validateGeneratedPages,
  GENERATED_TEMPLATE_ID,
  type StorefrontTemplateId,
} from "@/modules/tenant/storefront-templates";
import DashboardNav from "@/components/DashboardNav";
import StorefrontDesignWizard from "./StorefrontDesignWizard";

export const dynamic = "force-dynamic";

interface SearchParams {
  /** "content" deep-links straight to the wizard's content step — see StorefrontDesignWizard's CONTENT_STEP_INDEX. A named key, not a raw step number, so this link never breaks if the wizard's step order changes later. */
  focus?: string;
}

export default async function StorefrontDesignPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireOwnerSession();
  const sp = await searchParams;
  const workspaceContext = await getStaffWorkspaceContext(session);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: session.tenantId } });

  const [catalog, rating, reviews, templateSelection] = await Promise.all([
    getActiveCatalog(business.id),
    getRatingSummary(business.id),
    listPublishedReviews(business.id),
    getStorefrontTemplateSelection(business.id),
  ]);

  const initialConfig = getStorefrontConfig(business);
  const initialContent = getStorefrontContent(business);
  const { activeTemplateId: rawTemplateId, generatedTemplate } = templateSelection;
  const initialTemplateId: StorefrontTemplateId | null =
    rawTemplateId && isValidTemplateId(rawTemplateId) ? rawTemplateId : null;
  const initialGeneratedPages =
    rawTemplateId === GENERATED_TEMPLATE_ID ? validateGeneratedPages(generatedTemplate) : null;

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <DashboardNav current="storefront" {...workspaceContext} />
        <StorefrontDesignWizard
          business={{ ...business, subscription: null }}
          capabilities={[...workspaceContext.capabilities]}
          catalog={catalog}
          rating={rating}
          reviews={reviews}
          initialConfig={initialConfig}
          initialContent={initialContent}
          initialTemplateId={initialTemplateId}
          initialGeneratedPages={initialGeneratedPages}
          initialFocus={sp.focus === "content" ? "content" : undefined}
        />
      </div>
    </main>
  );
}
