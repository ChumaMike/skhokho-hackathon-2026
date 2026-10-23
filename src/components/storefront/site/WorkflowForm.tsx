import type { BusinessCategory } from "@prisma/client";
import { LEAD_LIMITS, fieldCopy, getWorkflow, type WorkflowId } from "@/modules/storefront-workflows/workflows";
import ConsentFields from "@/components/storefront/ConsentFields";
import HoneypotField from "@/components/HoneypotField";
import shared from "@/components/storefront/shopfront/Shopfront.module.css";
import styles from "./SitePage.module.css";

/**
 * The request form for one workflow (storefront-workflows/workflows.ts),
 * rendered from its field list — the storefront never invents a field the
 * API wouldn't accept. Plain HTML form, posts to /api/store/lead, works
 * without JavaScript on any phone. Photos only when the workflow takes
 * them (quote requests), via the browser's own picker and camera.
 */
export default function WorkflowForm({
  workflow,
  businessId,
  category,
  returnTo,
  pageSlug,
  services,
  compact = false,
}: {
  workflow: WorkflowId;
  businessId: string;
  category: BusinessCategory;
  /** Where to send the customer back to (the page the form sits on). */
  returnTo: string;
  pageSlug: string;
  /** Service names the customer can pick from, if the business lists any. */
  services?: string[];
  /** Inside another section (a service card) — no intro heading. */
  compact?: boolean;
}) {
  const def = getWorkflow(workflow);
  const idPrefix = `wf-${def.slug}`;

  return (
    <section className={styles.pageSection} id={`request-${def.slug}`} data-sf-section="CATALOGUE">
      <div className={shared.container}>
        {!compact && (
          <>
            <p className={shared.eyebrow}>{def.title}</p>
            <p className={styles.formIntro}>{def.intro}</p>
          </>
        )}
        <form method="post" action="/api/store/lead" encType="multipart/form-data" className={styles.form} data-sf-event="CTA_CLICK">
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="workflow" value={workflow} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="pageSlug" value={pageSlug} />
          <HoneypotField />

          <div className={styles.formRow}>
            <label className={styles.formLabel} htmlFor={`${idPrefix}-name`}>
              Your name
            </label>
            <input className={styles.formInput} id={`${idPrefix}-name`} name="name" required maxLength={LEAD_LIMITS.name} autoComplete="name" />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel} htmlFor={`${idPrefix}-phone`}>
              Phone or WhatsApp number
            </label>
            <input className={styles.formInput} id={`${idPrefix}-phone`} name="phone" type="tel" required inputMode="tel" autoComplete="tel" placeholder="+27 82 123 4567" />
          </div>

          {services && services.length > 0 && (
            <div className={styles.formRow}>
              <label className={styles.formLabel} htmlFor={`${idPrefix}-service`}>
                Which service?
              </label>
              <select className={styles.formInput} id={`${idPrefix}-service`} name="serviceName" defaultValue="">
                <option value="">Not sure yet</option>
                {services.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {def.fields.map((field) => {
            const copy = fieldCopy(field, category);
            const id = `${idPrefix}-${field.name}`;
            return (
              <div key={field.name} className={styles.formRow}>
                <label className={styles.formLabel} htmlFor={id}>
                  {copy.label}
                  {!field.required && <span className={styles.optional}> (optional)</span>}
                </label>
                {field.type === "select" ? (
                  <select className={styles.formInput} id={id} name={field.name} required={field.required} defaultValue={field.options?.[0]?.value}>
                    {field.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea className={styles.formInput} id={id} name={field.name} rows={4} required={field.required} maxLength={LEAD_LIMITS.message} placeholder={copy.placeholder} />
                ) : (
                  <input
                    className={styles.formInput}
                    id={id}
                    name={field.name}
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    inputMode={field.type === "number" ? "numeric" : undefined}
                    min={field.type === "number" ? 1 : undefined}
                    max={field.type === "number" ? LEAD_LIMITS.headcount : undefined}
                    required={field.required}
                    maxLength={LEAD_LIMITS.short}
                    placeholder={copy.placeholder}
                  />
                )}
              </div>
            );
          })}

          <div className={styles.formRow}>
            <label className={styles.formLabel} htmlFor={`${idPrefix}-message`}>
              {def.messageLabel}
              {!def.messageRequired && <span className={styles.optional}> (optional)</span>}
            </label>
            <textarea className={styles.formInput} id={`${idPrefix}-message`} name="message" rows={5} required={def.messageRequired} maxLength={LEAD_LIMITS.message} />
          </div>

          {def.photos && (
            <div className={styles.formRow}>
              <label className={styles.formLabel} htmlFor={`${idPrefix}-photos`}>
                Photos <span className={styles.optional}>(optional, up to {LEAD_LIMITS.photos})</span>
              </label>
              <input className={styles.formInput} id={`${idPrefix}-photos`} name="photos" type="file" accept="image/*" multiple />
              <span className={styles.formHint}>A quick photo helps us quote accurately. JPG, PNG or WEBP, under 5MB each.</span>
            </div>
          )}

          <ConsentFields idPrefix={idPrefix} />

          <button type="submit" className={`${shared.btn} ${shared.btnPrimary} ${styles.submit}`}>
            {def.submitLabel}
          </button>
        </form>
      </div>
    </section>
  );
}
