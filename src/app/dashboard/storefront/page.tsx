import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { prisma } from "@/lib/prisma/client";
import { getDeliverySettings } from "@/modules/tenant/capabilities";
import { getStorefrontConfig } from "@/modules/tenant/storefront-theme";
import { getStorefrontContent } from "@/modules/tenant/storefront-content";
import { getUnresolvedStorefrontRecommendations } from "@/modules/tenant/storefront-recommendations";
import { getBusinessExperience } from "@/modules/tenant/business-experience";
import { PLATFORM_DOMAIN } from "@/lib/tenant/context";
import { canonicalStorefrontUrl } from "@/modules/tenant/storefront-url";
import { getStorefrontManageSections } from "@/modules/tenant/storefront-console";
import { listProductsForOwner, listServicesForOwner } from "@/modules/catalog/catalog.service";
import { getPublishReadiness, getStorefrontTemplateSelection } from "@/modules/tenant/tenant.service";
import DashboardNav from "@/components/DashboardNav";
import ActionButton from "@/components/ActionButton";
import { publishBusinessAction } from "../actions";
import styles from "./storefront.module.css";

export const dynamic = "force-dynamic";

type StatusDotKind = "live" | "off" | "draft";

const STATUS_META: Record<string, { label: string; dot: StatusDotKind }> = {
  ACTIVE: { label: "Live", dot: "live" },
  SUSPENDED: { label: "Suspended", dot: "off" },
  DEACTIVATED: { label: "Deactivated", dot: "off" },
  PENDING_VERIFICATION: { label: "Draft — not published yet", dot: "draft" },
};

/**
 * The Storefront Overview (§5 of the Storefront Console milestone) — ONE
 * destination answering "what is live, what will customers see, what still
 * needs attention, where do I edit it." Everything here composes existing
 * domains (theme engine, capabilities, recommendations, catalogue) rather
 * than owning any of their data — see this milestone's §2. No fake
 * completion score: the "Improve" list is exactly
 * getUnresolvedStorefrontRecommendations's real, deterministic output.
 */
export default async function StorefrontHubPage() {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: session.tenantId } });

  const [products, services, templateSelection] = await Promise.all([
    listProductsForOwner(session.tenantId),
    listServicesForOwner(session.tenantId),
    getStorefrontTemplateSelection(session.tenantId),
  ]);

  const storefront = getStorefrontConfig(business);
  const content = getStorefrontContent(business);
  const hasStorefrontContent = !!(content.hero.headline || content.hero.subheadline || content.about.body || content.highlights.items.length > 0);
  const delivery = getDeliverySettings(business);
  const experience = getBusinessExperience(workspaceContext.businessCategory);
  const { capabilities } = workspaceContext;

  const manageSections = getStorefrontManageSections({
    capabilities,
    experience,
    designSummary: `${storefront.theme.presetId} · ${storefront.theme.heroMode.toLowerCase()} hero`,
    primaryActionLabel: storefront.theme.primaryAction ?? null,
    hasStorefrontContent,
  });

  const recommendations = getUnresolvedStorefrontRecommendations({
    business,
    capabilities,
    storefront,
    delivery,
    products: products.map((p) => ({ imageUrl: p.imageUrl })),
    services: services.map((s) => ({ imageUrl: s.imageUrl })),
    experience,
    templateSelection: { activeTemplateId: templateSelection.activeTemplateId },
  });

  const statusMeta = STATUS_META[business.status] ?? STATUS_META.PENDING_VERIFICATION;
  const publicUrl = `/store/${business.slug}`;
  // Same readiness check publishBusiness (tenant.service.ts) itself enforces
  // — this is a truthful preview of that real gate, not a second one. Only
  // fetched for PENDING_VERIFICATION: a live/suspended/deactivated business
  // has nothing to publish right now.
  const readiness = business.status === "PENDING_VERIFICATION" ? await getPublishReadiness(business.id) : null;

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Storefront</h1>
        <p className={styles.sub}>How customers see you when they visit your store.</p>

        <DashboardNav current="storefront" {...workspaceContext} />

        <section className={styles.section}>
          <div className={styles.statusRow}>
            <span
              className={`${styles.statusDot} ${
                statusMeta.dot === "live" ? styles.statusDotLive : statusMeta.dot === "off" ? styles.statusDotOff : ""
              }`}
            />
            <span className={styles.statusLabel}>{statusMeta.label}</span>
          </div>
          <p className={styles.publicUrl}>{canonicalStorefrontUrl(business.slug).replace(/^https?:\/\//, "")}</p>

          {readiness && !readiness.ready && (
            <p className={styles.infoSub}>
              Not ready to publish yet — {readiness.missing.join(", ").toLowerCase()}.
            </p>
          )}

          <div className={styles.actionsRow}>
            <Link href="/dashboard/preview" className="btn">
              Preview
            </Link>
            <Link href="/dashboard/storefront/ai" className="btn">
              Build with AI
            </Link>
            {readiness ? (
              <ActionButton action={publishBusinessAction} className="btn btnPrimary" pendingLabel="Publishing…">
                Publish business
              </ActionButton>
            ) : (
              <Link href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn btnPrimary">
                View storefront
              </Link>
            )}
          </div>
        </section>

        {recommendations.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Improve your storefront</h2>
            <ul className={styles.recList}>
              {recommendations.map((rec) => (
                <li key={rec.type} className="card">
                  <Link href={rec.href}>{rec.message}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Manage</h2>
          <div className={styles.manageGrid}>
            {manageSections.map((section) => (
              <Link key={section.id} href={section.href} className={`card ${styles.manageCard}`}>
                <span className={styles.manageCardTitle}>{section.label}</span>
                <span className={styles.manageCardSub}>{section.sub}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.section} style={{ marginTop: 8 }}>
          <h2 className={styles.sectionTitle}>Domains</h2>
          <p className={styles.infoSub}>
            Custom domains are coming soon — every storefront already has a free {PLATFORM_DOMAIN} address.
          </p>
          <p>
            <Link href="/dashboard/settings/domains">Manage custom domains →</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
