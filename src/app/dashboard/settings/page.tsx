import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import { getThemePreference } from "@/lib/theme";
import {
  getOrderingSettings,
  getBusinessCapabilities,
  categoryDefaultCapabilities,
  MODULE_INFO,
  SWITCHABLE_MODULES,
} from "@/modules/tenant/capabilities";
import { getBusinessEmailState } from "@/modules/tenant/business-email";
import { getBusinessEntitlements } from "@/modules/billing/subscription.service";
import { hasFeature, type Entitlements } from "@/modules/billing/entitlements";
import { legalInformationGaps, LEGAL_GAP_LABELS } from "@/modules/tenant/legal-information";
import DashboardNav from "@/components/DashboardNav";
import ImageFileInput from "@/components/dashboard/ImageFileInput";
import {
  updateSettings,
  updateMinimumOrder,
  setTheme,
  requestEmailChangeAction,
  resendEmailChangeAction,
  cancelEmailChangeAction,
  setModuleAction,
} from "./actions";
import styles from "./settings.module.css";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; err?: string; emailPending?: string; emailVerified?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  // A session already exists — the only outcome that matters here is
  // permitted vs not, same reasoning as dashboard/analytics/page.tsx.
  let permitted = true;
  try {
    await requireStaffPermission("canManageSettings");
  } catch {
    permitted = false;
  }

  // Four independent reads in one round trip, not four in a row: on a slow
  // connection to a far database that is the difference between the page
  // arriving and the merchant giving up on it.
  const [business, theme, emailState, entitlements] = await Promise.all([
    prisma.business.findUnique({ where: { id: session.tenantId } }),
    getThemePreference(),
    permitted ? getBusinessEmailState(session.tenantId) : Promise.resolve(null),
    permitted ? getBusinessEntitlements(session.tenantId) : Promise.resolve(null),
  ]);
  const legalGaps = business ? legalInformationGaps(business) : [];

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Business settings</h1>

        <DashboardNav current="settings" {...workspaceContext} />

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>
          <p className={styles.sub}>This is just for you — it doesn&apos;t change what customers see.</p>
          <div className={styles.themeRow}>
            {(["light", "dark", "system"] as const).map((option) => (
              <form key={option} action={setTheme.bind(null, option)}>
                <button
                  type="submit"
                  className={`${styles.themeBtn} ${theme === option ? styles.themeBtnActive : ""}`}
                  aria-pressed={theme === option}
                >
                  {option === "light" ? "Light" : option === "dark" ? "Dark" : "System"}
                </button>
              </form>
            ))}
          </div>
        </section>

        {!permitted ? (
          <div className="errorBanner">
            Your role doesn&apos;t have permission to change settings — ask the business owner.
          </div>
        ) : !business ? (
          <div className="errorBanner">Could not load your business.</div>
        ) : (
          <>
            {sp.saved === "1" && <div className="successBanner">Saved.</div>}
            {sp.emailVerified === "1" && (
              <div className="successBanner">Your new contact email is confirmed and now shows on your storefront.</div>
            )}
            {sp.emailPending === "1" && !sp.err && (
              <div className="successBanner">Check the inbox of the new address — the change happens once you open the link we sent.</div>
            )}
            {sp.err && <div className="errorBanner">{sp.err}</div>}

            <form action={updateSettings} className={styles.form}>
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>About</h2>
                <div className="field">
                  <label className="label" htmlFor="name">
                    Business name
                  </label>
                  <input
                    className="input"
                    id="name"
                    name="name"
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
                  <ImageFileInput id="logo" name="logo" />
                  <p className={styles.sub} style={{ marginTop: 6 }}>JPG, PNG, WEBP or GIF, under 4 MB.</p>
                </div>
              </section>

              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Contact</h2>
                <div className={styles.row}>
                  <div className="field">
                    <label className="label" htmlFor="phone">
                      Phone
                    </label>
                    <input
                      className="input"
                      id="phone"
                      name="phone"
                      type="tel"
                      defaultValue={business.phone ?? ""}
                    />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="whatsapp">
                      WhatsApp
                    </label>
                    <input
                      className="input"
                      id="whatsapp"
                      name="whatsapp"
                      type="tel"
                      defaultValue={business.whatsapp ?? ""}
                    />
                  </div>
                </div>
              </section>

              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Location</h2>
                <div className="field">
                  <label className="label" htmlFor="address">
                    Street address
                  </label>
                  <input
                    className="input"
                    id="address"
                    name="address"
                    defaultValue={business.address ?? ""}
                  />
                </div>
                <div className={styles.row}>
                  <div className="field">
                    <label className="label" htmlFor="suburb">
                      Suburb
                    </label>
                    <input
                      className="input"
                      id="suburb"
                      name="suburb"
                      defaultValue={business.suburb ?? ""}
                    />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="city">
                      City
                    </label>
                    <input className="input" id="city" name="city" defaultValue={business.city ?? ""} />
                  </div>
                </div>
                <div className={styles.row}>
                  <div className="field">
                    <label className="label" htmlFor="province">
                      Province
                    </label>
                    <input
                      className="input"
                      id="province"
                      name="province"
                      defaultValue={business.province ?? ""}
                    />
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

              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Branding</h2>
                <div className={styles.row}>
                  <div className="field">
                    <label className="label" htmlFor="primaryColor">
                      Primary colour
                    </label>
                    <input
                      className={styles.colorInput}
                      id="primaryColor"
                      name="primaryColor"
                      type="color"
                      defaultValue={business.primaryColor ?? "#E8A020"}
                    />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="accentColor">
                      Accent colour
                    </label>
                    <input
                      className={styles.colorInput}
                      id="accentColor"
                      name="accentColor"
                      type="color"
                      defaultValue={business.accentColor ?? "#F59E0B"}
                    />
                  </div>
                </div>
              </section>

              <button type="submit" className="btn btnPrimary btnBlock">
                Save changes
              </button>
            </form>

            {emailState && <ContactEmailSection state={emailState} />}

            <ModulesSection business={business} entitlements={entitlements} />

            {workspaceContext.capabilities.has("ORDERS") && (
              <section className={styles.section} style={{ marginTop: 8 }}>
                <h2 className={styles.sectionTitle}>Opening hours & pausing orders</h2>
                <p>
                  <Link href="/dashboard/settings/hours">Set your weekly hours, or pause orders for a while →</Link>
                </p>
              </section>
            )}

            {workspaceContext.capabilities.has("ORDERS") && (
              <section className={styles.section} style={{ marginTop: 8 }}>
                <h2 className={styles.sectionTitle}>Collection & delivery</h2>
                <p>
                  <Link href="/dashboard/settings/fulfilment">Collection, delivery pricing, delivery areas and who delivers →</Link>
                </p>
              </section>
            )}

            {workspaceContext.capabilities.has("ORDERS") && (
              <MinimumOrderSection business={business} />
            )}

            <section className={styles.section} style={{ marginTop: 8 }}>
              <h2 className={styles.sectionTitle}>Storefront</h2>
              <p>
                <Link href="/dashboard/storefront">Design your storefront →</Link>
              </p>
            </section>

            <section className={styles.section} style={{ marginTop: 8 }}>
              <h2 className={styles.sectionTitle}>Payments</h2>
              <p>
                <Link href="/dashboard/settings/payments">Get paid online →</Link>
              </p>
            </section>

            <section className={styles.section} style={{ marginTop: 8 }}>
              <h2 className={styles.sectionTitle}>Domains</h2>
              <p>
                <Link href="/dashboard/settings/domains">Manage custom domains →</Link>
              </p>
            </section>

            <section className={styles.section} style={{ marginTop: 8 }}>
              <h2 className={styles.sectionTitle}>Legal</h2>
              <p className={styles.sub}>
                {legalGaps.length > 0
                  ? `Your storefront footer is missing: ${legalGaps.map((g) => LEGAL_GAP_LABELS[g]).join(", ")}.`
                  : "Legal name, returns terms and complaints contact are shown on your storefront."}
              </p>
              <p>
                <Link href="/dashboard/settings/legal">Legal name, returns and cancellations, complaints contact →</Link>
              </p>
            </section>

            {/* Tab 4: what the business pays Skhokho Laboratory — distinct from
                Payments above, which is where its own customers' money goes. */}
            <section className={styles.section} style={{ marginTop: 8 }}>
              <h2 className={styles.sectionTitle}>Your plan</h2>
              <p>
                <Link href="/dashboard/settings/plan">See your plan, usage and invoices →</Link>
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

/**
 * The self-serve control for setOrderingSettings/getOrderingSettings — a
 * deliberate duplicate of this exact form on /dashboard/storefront/
 * ordering too, same reasoning DeliverySection's own doc comment gives for
 * Delivery already existing in two places: both call the same setter
 * independently, neither delegates to the other.
 */
function MinimumOrderSection({ business }: { business: { settings: unknown } }) {
  const ordering = getOrderingSettings(business);
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Minimum order</h2>
      <p className={styles.sub}>Applies to every order — collection and delivery. Leave at 0 for no minimum.</p>
      <form action={updateMinimumOrder} className={styles.form}>
        <div className="field">
          <label className="label" htmlFor="minOrder">
            Minimum order (R)
          </label>
          <input
            className="input"
            id="minOrder"
            name="minOrder"
            type="number"
            step="0.01"
            min="0"
            defaultValue={(ordering.minOrderCents / 100).toFixed(2)}
          />
        </div>
        <button type="submit" className="btn btnPrimary">
          Save minimum order
        </button>
      </form>
    </section>
  );
}

/**
 * The contact email lives outside the main form on purpose: it isn't saved
 * with the other details. A new address only takes effect once a link sent
 * to it is opened (business-email.ts), so a typo can never become the
 * shop's public contact. Until then the current address stays live.
 */
function ContactEmailSection({ state }: { state: Awaited<ReturnType<typeof getBusinessEmailState>> }) {
  return (
    <section className={styles.section} style={{ marginTop: 8 }}>
      <h2 className={styles.sectionTitle}>Contact email</h2>
      <p className={styles.sub}>Shown to customers on your storefront. This is separate from the email you sign in with.</p>
      <p>
        <strong>Current:</strong> {state.email ?? "none yet"}
        {state.email && (state.emailVerifiedAt ? " · confirmed" : " · not confirmed yet")}
      </p>
      {state.pendingEmail ? (
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0 }}>
            Waiting for you to confirm <strong>{state.pendingEmail}</strong>.{" "}
            {state.pendingLinkValid ? "Open the link we emailed to that address." : "That link has expired — send a new one."}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={resendEmailChangeAction}>
              <button type="submit" className="btn btnSecondary">
                Send the link again
              </button>
            </form>
            <form action={cancelEmailChangeAction}>
              <button type="submit" className="btn">
                Keep the current email
              </button>
            </form>
          </div>
        </div>
      ) : (
        <form action={requestEmailChangeAction} className={styles.form}>
          <div className="field">
            <label className="label" htmlFor="newEmail">
              New contact email
            </label>
            <input className="input" id="newEmail" name="newEmail" type="email" required maxLength={254} autoComplete="email" />
          </div>
          <button type="submit" className="btn btnSecondary">
            Send confirmation link
          </button>
        </form>
      )}
    </section>
  );
}

/**
 * Settings › Modules — the switches for what a business does. The category
 * only sets the starting point; a food vendor can switch Bookings on here
 * without anyone at Skhokho touching the database. A module the plan
 * doesn't include shows why instead of a switch. The decision itself is
 * applyModuleToggle (capabilities.ts); this is presentation.
 */
function ModulesSection({
  business,
  entitlements,
}: {
  business: { category: Parameters<typeof categoryDefaultCapabilities>[0]; settings: unknown };
  entitlements: Entitlements | null;
}) {
  const effective = getBusinessCapabilities(business);
  const defaults = new Set(categoryDefaultCapabilities(business.category));
  return (
    <section className={styles.section} style={{ marginTop: 8 }}>
      <h2 className={styles.sectionTitle}>Modules</h2>
      <p className={styles.sub}>
        Switch on what your business does. Your business type sets the starting point — you can change it any time.
        Delivery has its own switch under Collection &amp; delivery.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {SWITCHABLE_MODULES.map((module) => {
          const info = MODULE_INFO[module];
          const on = effective.has(module);
          const locked = Boolean(info.planFeature && !(entitlements && hasFeature(entitlements, info.planFeature)));
          return (
            <li key={module} className="card" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 2 }}>
                <strong>
                  {info.label}
                  {defaults.has(module) ? <span style={{ fontWeight: 400, opacity: 0.7 }}> · included for your business type</span> : null}
                </strong>
                <span style={{ fontSize: "0.92rem", opacity: 0.85 }}>{info.description}</span>
                {locked && !on && (
                  <span style={{ fontSize: "0.88rem", opacity: 0.8 }}>Not included in your plan yet — upgrade to switch this on.</span>
                )}
              </div>
              {locked && !on ? (
                <span className="btn" aria-disabled="true" style={{ opacity: 0.6 }}>
                  Off
                </span>
              ) : (
                <form action={setModuleAction.bind(null, module, !on)}>
                  <button type="submit" className={on ? "btn btnSecondary" : "btn btnPrimary"} aria-pressed={on}>
                    {on ? "Switch off" : "Switch on"}
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
