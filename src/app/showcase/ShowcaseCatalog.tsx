"use client";

import { useState } from "react";
import EnquiryModal from "./EnquiryModal";
import { SERVICES, formatRand, type ShowcasePlan } from "./data";
import styles from "./showcase.module.css";

interface Selection {
  interest: string;
  label: string;
}

/**
 * The two groups the task asks for — platform plans (what the flags on
 * `BusinessSubscription` unlock) and add-on services (what the studio
 * builds) — plus the enquiry modal shared by every card's button. Split
 * from page.tsx because the click handlers and modal state need a client
 * component; plans arrive as props (read from the database by page.tsx),
 * services are static in ./data.ts.
 */
export default function ShowcaseCatalog({ plans }: { plans: ShowcasePlan[] }) {
  const [selection, setSelection] = useState<Selection | null>(null);

  return (
    <>
      <section className={styles.section}>
        <span className="eyebrow">Platform plans</span>
        <h2 className={styles.sectionTitle}>What&apos;s built in</h2>
        <p className={styles.sectionText}>
          Every business runs on one of these. Higher plans lift the limits
          and switch more on — no plan changes what it costs to enquire.
        </p>

        <div className={styles.cardList}>
          {plans.map((plan) => (
            <article key={plan.code} className={`card ${styles.planCard}`}>
              <header className={styles.planHeader}>
                <h3 className={styles.planName}>{plan.name}</h3>
              </header>
              <p className={`mono ${styles.servicePrice}`}>{plan.priceLabel}</p>
              {plan.tagline && <p className={styles.planTagline}>{plan.tagline}</p>}

              <ul className={styles.limitList}>
                {plan.limits.map((limit) => (
                  <li key={limit.label}>
                    {limit.value} {limit.label.toLowerCase()}
                  </li>
                ))}
              </ul>

              <ul className={styles.featureList}>
                {plan.features.map((row) => {
                  const included = row.included;
                  return (
                    <li key={row.key} className={styles.featureRow}>
                      <span>{row.label}</span>
                      <span
                        className={
                          included ? styles.featureYes : styles.featureNo
                        }
                      >
                        {included ? "Included" : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <button
                type="button"
                className="btn btnSecondary btnBlock"
                onClick={() =>
                  setSelection({ interest: plan.code, label: `The ${plan.name} plan` })
                }
              >
                Enquire
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <span className="eyebrow">Add-on services</span>
        <h2 className={styles.sectionTitle}>Hand-built by the studio</h2>
        <p className={styles.sectionText}>
          Beyond the platform, we build these for you — a real website,
          WhatsApp ordering, a phone line that answers itself.
        </p>

        <div className={styles.cardList}>
          {SERVICES.map((service) => (
            <article key={service.slug} className={`card ${styles.serviceCard}`}>
              <h3 className={styles.serviceName}>{service.name}</h3>
              <p className={styles.serviceBlurb}>{service.blurb}</p>
              <p className={`mono ${styles.servicePrice}`}>
                {service.setupFrom ? "From " : ""}
                {formatRand(service.setup)} setup + {service.monthlyFrom ? "from " : ""}
                {formatRand(service.monthly)}/mo
              </p>
              <button
                type="button"
                className="btn btnPrimary btnBlock"
                onClick={() =>
                  setSelection({ interest: service.slug, label: service.name })
                }
              >
                Enquire
              </button>
            </article>
          ))}
        </div>
      </section>

      {selection && (
        <EnquiryModal
          interest={selection.interest}
          label={selection.label}
          onClose={() => setSelection(null)}
        />
      )}
    </>
  );
}
