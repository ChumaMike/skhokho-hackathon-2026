import Link from "next/link";
import { buildEctaInformation, type EctaSourceBusiness } from "@/modules/tenant/legal-information";
import styles from "./EctaInformation.module.css";

/**
 * The ECTA s43 "about this business" block every storefront footer shows —
 * docs/legal/ecta-storefront-information.md is the template it renders.
 * Real data only: every line comes from the business profile or
 * Dashboard › Settings › Legal, with the documented fallbacks (trading name
 * when no legal name yet; WhatsApp → phone → email for complaints).
 * Merchant readiness flags the fallbacks as NEEDS ACTION, so a published
 * storefront with a missing legal name is visible to the operator rather
 * than hidden by this component inventing one.
 *
 * `tone` only picks the colour scheme: "light" for the classic storefront's
 * page-coloured footer, "dark" for the Connected Shopfront's board footer.
 */
export default function EctaInformation({ business, tone = "light" }: { business: EctaSourceBusiness; tone?: "light" | "dark" }) {
  const info = buildEctaInformation(business);
  const contacts = [
    info.phone ? `Phone ${info.phone}` : null,
    info.whatsapp ? `WhatsApp ${info.whatsapp}` : null,
    info.email ? `Email ${info.email}` : null,
  ].filter(Boolean);

  return (
    <section className={`${styles.block} ${tone === "dark" ? styles.dark : ""}`} aria-label="About this business">
      <div className={styles.cols}>
        <div>
          <h3 className={styles.heading}>About this business</h3>
          <p className={styles.line}>
            <strong>{info.legalName}</strong>
            {info.tradingAs && <>, trading as {info.tradingAs}</>}
          </p>
          {info.registrationNumber && <p className={styles.line}>Registration number {info.registrationNumber}</p>}
          {info.addressLine && <p className={styles.line}>{info.addressLine}</p>}
          {contacts.length > 0 && <p className={styles.line}>{contacts.join(" · ")}</p>}
        </div>
        <div>
          <h3 className={styles.heading}>Returns and cancellations</h3>
          <p className={styles.line}>
            {info.returnsText ?? "Ask this business about returns and cancellations before you order. Your rights under the Consumer Protection Act are not affected."}
          </p>
        </div>
        <div>
          <h3 className={styles.heading}>Complaints</h3>
          <p className={styles.line}>{info.complaintsContact ? `Contact ${info.complaintsContact}` : "Contact this business directly."}</p>
        </div>
      </div>
      <p className={styles.platform}>
        Prices in South African rand. Orders and bookings are a contract with {info.legalName}. Platform: Skhokho Laboratory (&ldquo;Skhokho Labs&rdquo;) ·{" "}
        <Link href={info.terms.path}>Terms</Link> · <Link href={info.privacy.path}>Privacy</Link>
      </p>
    </section>
  );
}
