import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import DashboardNav from "@/components/DashboardNav";
import { updateBusinessInformation } from "./actions";
import styles from "../storefront.module.css";

export const dynamic = "force-dynamic";

/**
 * Consolidated, customer-framed business-information editor (§8 of the
 * Storefront Console milestone) — reuses updateBusiness (via
 * updateBusinessInformation) as its one write path, the same function
 * dashboard/settings/actions.ts's updateSettings already calls. Settings
 * itself is untouched; this is a second, storefront-contextual door onto
 * the same data, not a duplicate copy of it.
 *
 * Fields are grouped by what a customer actually sees (verified against
 * StorefrontView.tsx: name/description/phone/whatsapp/address/suburb/city/
 * logo are all rendered there) versus what exists on the Business record
 * but is never shown to a customer (province/postalCode — no
 * StorefrontView reference at all). Branding colours are deliberately
 * absent here — those belong to Design (Storefront Theme Engine), the one
 * authoritative place theme controls live (§7).
 */
export default async function StorefrontBusinessInformationPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; err?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  let permitted = true;
  try {
    await requireStaffPermission("canManageSettings");
  } catch {
    permitted = false;
  }

  const business = permitted ? await prisma.business.findUnique({ where: { id: session.tenantId } }) : null;

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Business information</h1>
        <p className={styles.sub}>What customers see and how they reach you.</p>

        <DashboardNav current="storefront" {...workspaceContext} />

        {!permitted ? (
          <div className="errorBanner">
            Your role doesn&apos;t have permission to change business information — ask the business owner.
          </div>
        ) : !business ? (
          <div className="errorBanner">Could not load your business.</div>
        ) : (
          <>
            {sp.saved === "1" && <div className="successBanner">Saved.</div>}
            {sp.err && <div className="errorBanner">{sp.err}</div>}

            <form action={updateBusinessInformation} className={styles.form}>
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Shown to customers</h2>
                <p className={styles.fieldGroupIntro}>
                  Everything in this section can appear on your public storefront.
                </p>

                <div className="field">
                  <label className="label" htmlFor="name">
                    Business name
                  </label>
                  <input
                    className="input"
                    id="name"
                    name="name"
                    autoComplete="organization"
                    required
                    maxLength={100}
                    defaultValue={business.name}
                  />
                </div>

                <div className="field">
                  <label className="label" htmlFor="description">
                    Description
                  </label>
                  <input
                    className="input"
                    id="description"
                    name="description"
                    maxLength={2000}
                    defaultValue={business.description ?? ""}
                  />
                  <span className={styles.fieldHint}>A short line customers see near the top of your storefront.</span>
                </div>

                <div className="field">
                  <label className="label" htmlFor="logo">
                    Logo
                  </label>
                  {business.logoUrl && (
                    // Business-supplied logo, not a bundled asset — plain img.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={business.logoUrl} alt="" className={styles.currentLogo} />
                  )}
                  <input
                    className="input"
                    id="logo"
                    name="logo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                  />
                </div>

                <div className="field">
                  <label className="label" htmlFor="phone">
                    Customer-facing phone
                  </label>
                  <input
                    className="input"
                    id="phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    defaultValue={business.phone ?? ""}
                  />
                  <span className={styles.fieldHint}>Customers can call this number from your storefront.</span>
                </div>

                <div className="field">
                  <label className="label" htmlFor="whatsapp">
                    WhatsApp number
                  </label>
                  <input
                    className="input"
                    id="whatsapp"
                    name="whatsapp"
                    type="tel"
                    autoComplete="tel"
                    defaultValue={business.whatsapp ?? ""}
                  />
                  <span className={styles.fieldHint}>Customers can message this number from your storefront.</span>
                </div>

                <div className="field">
                  <label className="label" htmlFor="address">
                    Street address
                  </label>
                  <input className="input" id="address" name="address" defaultValue={business.address ?? ""} />
                </div>
                <div className={styles.row}>
                  <div className="field">
                    <label className="label" htmlFor="suburb">
                      Suburb
                    </label>
                    <input className="input" id="suburb" name="suburb" defaultValue={business.suburb ?? ""} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="city">
                      City
                    </label>
                    <input className="input" id="city" name="city" defaultValue={business.city ?? ""} />
                  </div>
                </div>
                <span className={styles.fieldHint}>
                  Shown to customers whose primary action is &quot;Visit us&quot;, and used for delivery context.
                </span>
              </section>

              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Internal only</h2>
                <p className={styles.fieldGroupIntro}>Not shown on your storefront — for your own records.</p>
                <div className={styles.row}>
                  <div className="field">
                    <label className="label" htmlFor="province">
                      Province
                    </label>
                    <input className="input" id="province" name="province" defaultValue={business.province ?? ""} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="postalCode">
                      Postal code
                    </label>
                    <input
                      className="input"
                      id="postalCode"
                      name="postalCode"
                      defaultValue={business.postalCode ?? ""}
                    />
                  </div>
                </div>
              </section>

              <button type="submit" className="btn btnPrimary btnBlock">
                Save changes
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
