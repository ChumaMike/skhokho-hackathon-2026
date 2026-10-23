/**
 * Shared Product/Service editor building blocks (§4, Vertical Editor
 * Foundation). Consistent validated fields, not a schema-driven form
 * framework — each component is a thin, literal wrapper around the existing
 * global `.field`/`.label`/`.input` classes every dashboard form already
 * uses, so adopting these doesn't change any visual styling, only removes
 * duplication between ProductFields and ServiceFields.
 */

import styles from "./EditorFields.module.css";

export function EditorSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <p className={styles.sectionHeading}>{heading}</p>
      {children}
    </div>
  );
}

export function NameField({ idPrefix, label, defaultValue }: { idPrefix: string; label: string; defaultValue?: string }) {
  return (
    <div className="field">
      <label className="label" htmlFor={`${idPrefix}-name`}>
        {label}
      </label>
      <input className="input" id={`${idPrefix}-name`} name="name" required maxLength={200} defaultValue={defaultValue} />
    </div>
  );
}

export function DescriptionField({ idPrefix, label, defaultValue }: { idPrefix: string; label: string; defaultValue?: string }) {
  return (
    <div className="field">
      <label className="label" htmlFor={`${idPrefix}-description`}>
        {label} (optional)
      </label>
      <input
        className="input"
        id={`${idPrefix}-description`}
        name="description"
        maxLength={2000}
        defaultValue={defaultValue}
      />
    </div>
  );
}

/**
 * Social products (Tab 7): up to eight hashtags, typed any way the merchant
 * likes ("#kota #soweto" or "kota, soweto") — lib/storefront/share.ts tidies
 * them. Shown on the product, carried in every share, and each one gets a
 * page of this shop's products at /tag/<tag>.
 */
export function HashtagsField({ idPrefix, defaultValue }: { idPrefix: string; defaultValue?: string }) {
  return (
    <div className="field">
      <label className="label" htmlFor={`${idPrefix}-hashtags`}>
        Hashtags (optional)
      </label>
      <span className={styles.hint}>Up to eight, like #kota #soweto. Customers see them on the item and they go with every share.</span>
      <input className="input" id={`${idPrefix}-hashtags`} name="hashtags" maxLength={600} placeholder="#kota #soweto" defaultValue={defaultValue} autoCapitalize="none" autoCorrect="off" />
    </div>
  );
}

export function MoneyField({ idPrefix, label, defaultValue }: { idPrefix: string; label: string; defaultValue?: string }) {
  return (
    <div className="field">
      <label className="label" htmlFor={`${idPrefix}-price`}>
        {label}
      </label>
      <input
        className="input"
        id={`${idPrefix}-price`}
        name="price"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        required
        defaultValue={defaultValue}
      />
    </div>
  );
}

export function NumberField({
  idPrefix,
  name,
  label,
  placeholder,
  defaultValue,
}: {
  idPrefix: string;
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: number;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={`${idPrefix}-${name}`}>
        {label}
      </label>
      <input
        className="input"
        id={`${idPrefix}-${name}`}
        name={name}
        type="number"
        inputMode="numeric"
        min="1"
        placeholder={placeholder}
        defaultValue={defaultValue}
      />
    </div>
  );
}

export function PhotoField({
  idPrefix,
  label,
  guidance,
  currentImageUrl,
}: {
  idPrefix: string;
  label: string;
  guidance: string;
  currentImageUrl?: string | null;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={`${idPrefix}-image`}>
        {label} (optional)
      </label>
      <span className={styles.hint}>{guidance}</span>
      {currentImageUrl && (
        // Business-supplied photo, not a bundled asset — plain img.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentImageUrl} alt="" className={styles.currentImage} />
      )}
      <input
        className="input"
        id={`${idPrefix}-image`}
        name="image"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
      />
    </div>
  );
}

/** The consequence copy next to the existing Hide/Show control (§12) — not a
 *  new toggle, just truthful wording alongside the real one. */
export function AvailabilityNote({ hint }: { hint: string }) {
  return <p className={styles.availabilityNote}>{hint}</p>;
}
