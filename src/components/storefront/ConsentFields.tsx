import styles from "./ConsentFields.module.css";
import { TERMS_VERSION } from "@/lib/legal/documents";

/**
 * Shared by the product-order and service-booking forms — email is
 * optional (only used to send a confirmation for THIS booking — never
 * stored on the customer's identity) and the Terms checkbox is required to
 * submit. No marketing opt-in here: a public form can't prove the person
 * owns the phone number, so marketing consent is only recorded where it can
 * be confirmed (in person by staff; OTP later).
 *
 * The hidden `termsVersion` is the Terms version this form showed; the
 * booking route refuses anything but the current version and records it on
 * the appointment (src/lib/legal/documents.ts).
 *
 * Moved out of StorefrontView.tsx when Services became its own
 * ServicesSection component (Phase 6) — this is the one piece both it and
 * any future product-order form still share.
 */
export default function ConsentFields({ idPrefix }: { idPrefix: string }) {
  return (
    <>
      <input
        className="input"
        type="email"
        name="email"
        placeholder="Email (optional, for a confirmation)"
        aria-label="Your email, optional"
      />
      <input type="hidden" name="termsVersion" value={TERMS_VERSION} />
      <label htmlFor={`${idPrefix}-consent`} className={styles.consentRow}>
        <input type="checkbox" id={`${idPrefix}-consent`} name="consent" required />
        <span>
          I agree to Skhokho&apos;s <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> and have read the{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Notice</a> (version {TERMS_VERSION})
        </span>
      </label>
    </>
  );
}
