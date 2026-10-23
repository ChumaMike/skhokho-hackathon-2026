import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import { getLegalInformation, legalInformationGaps, LEGAL_GAP_LABELS, LEGAL_LIMITS } from "@/modules/tenant/legal-information";
import DashboardNav from "@/components/DashboardNav";
import { updateLegalInformation } from "./actions";
import styles from "../settings.module.css";

export const dynamic = "force-dynamic";

/**
 * Dashboard › Settings › Legal — the four things the storefront's ECTA
 * section 43 block needs from the owner (docs/legal/
 * ecta-storefront-information.md). Address and contact details come from
 * the main Settings page and are shown here read-only so the owner sees
 * the whole block they are publishing.
 */
export default async function LegalSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; err?: string }> }) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;
  let permitted = true;
  try {
    await requireStaffPermission("canManageSettings");
  } catch {
    permitted = false;
  }
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: session.tenantId },
    select: { name: true, settings: true, phone: true, whatsapp: true, email: true, address: true, suburb: true, city: true, province: true, postalCode: true },
  });
  const legal = getLegalInformation(business);
  const gaps = legalInformationGaps(business);
  const addressLine = [business.address, business.suburb, business.city, business.province, business.postalCode].filter(Boolean).join(", ");
  const contactLine = [business.phone, business.whatsapp && `WhatsApp ${business.whatsapp}`, business.email].filter(Boolean).join(" · ");

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Legal details</h1>
        <DashboardNav current="settings" {...workspaceContext} />
        {sp.saved && <div className="successBanner">Saved. Your storefront footer now shows these details.</div>}
        {sp.err && <div className="errorBanner">{sp.err}</div>}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Why this matters</h2>
          <p className={styles.sub}>
            South African law (the Electronic Communications and Transactions Act, section 43) says an online seller must tell customers who they are buying from, where you are, how to reach you, and what happens if they want to return or cancel. Your storefront shows this in its footer, filled from here and from your business details.
          </p>
          {gaps.length > 0 ? (
            <p className={styles.sub} style={{ fontWeight: 600 }}>
              Still missing: {gaps.map((g) => LEGAL_GAP_LABELS[g]).join(", ")}. Until these are in, your business shows as &ldquo;needs action&rdquo; on the platform.
            </p>
          ) : (
            <p className={styles.sub}>All set — nothing missing.</p>
          )}
        </section>

        {!permitted ? (
          <div className="errorBanner">Your role doesn&apos;t have permission to change settings — ask the business owner.</div>
        ) : (
          <form action={updateLegalInformation} className={styles.form}>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Who the customer is buying from</h2>
              <div className="field">
                <label className="label" htmlFor="legalName">
                  Legal name
                </label>
                <input
                  className="input"
                  id="legalName"
                  name="legalName"
                  maxLength={LEGAL_LIMITS.legalName}
                  defaultValue={legal.legalName ?? ""}
                  placeholder={`e.g. ${business.name} (Pty) Ltd, or your full name if you trade in your own name`}
                />
                <p className={styles.sub}>
                  The registered company or close corporation name, or your own full name if you are a sole trader. Your shop name &ldquo;{business.name}&rdquo; is shown as &ldquo;trading as&rdquo; when it differs.
                </p>
              </div>
              <div className="field">
                <label className="label" htmlFor="registrationNumber">
                  Registration number (optional)
                </label>
                <input
                  className="input"
                  id="registrationNumber"
                  name="registrationNumber"
                  maxLength={LEGAL_LIMITS.registrationNumber}
                  defaultValue={legal.registrationNumber ?? ""}
                  placeholder="e.g. 2024/123456/07"
                />
                <p className={styles.sub}>Your CIPC registration number, if the business is registered. Leave blank if you are a sole trader.</p>
              </div>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Returns and cancellations</h2>
              <div className="field">
                <label className="label" htmlFor="returnsText">
                  What happens if a customer wants to cancel or return
                </label>
                <textarea
                  className="input"
                  id="returnsText"
                  name="returnsText"
                  rows={6}
                  maxLength={LEGAL_LIMITS.returnsText}
                  defaultValue={legal.returnsText ?? ""}
                  placeholder="Say plainly how a customer cancels an order or booking, whether and when goods can be returned, and how refunds work."
                />
                <p className={styles.sub}>
                  Say it plainly. Customers have rights under the Consumer Protection Act that you cannot take away — if you are not sure, say &ldquo;We follow the Consumer Protection Act&rdquo; and explain how to contact you. Examples: for prepared food, say that it cannot be returned once made but you will replace or refund a wrong order reported within a set time; for bookings, say how late a customer may cancel free of charge.
                </p>
              </div>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Complaints</h2>
              <div className="field">
                <label className="label" htmlFor="complaintsContact">
                  Where customers complain
                </label>
                <input
                  className="input"
                  id="complaintsContact"
                  name="complaintsContact"
                  maxLength={LEGAL_LIMITS.complaintsContact}
                  defaultValue={legal.complaintsContact ?? ""}
                  placeholder="A phone number, WhatsApp number or email address"
                />
                <p className={styles.sub}>
                  Leave blank to use your WhatsApp, phone or email from your business details{contactLine ? ` (currently: ${contactLine})` : " — none set yet"}.
                </p>
              </div>
            </section>

            <button type="submit" className="btn btnPrimary btnBlock">
              Save legal details
            </button>
          </form>
        )}

        <section className={styles.section} style={{ marginTop: 8 }}>
          <h2 className={styles.sectionTitle}>Also shown in the block</h2>
          <p className={styles.sub}>Address: {addressLine || "not set"}</p>
          <p className={styles.sub}>Contact: {contactLine || "not set"}</p>
          <p>
            <Link href="/dashboard/settings">Change address and contact details →</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
