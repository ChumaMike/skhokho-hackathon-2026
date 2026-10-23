import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import { listDomains, getDomainDnsInstructions, type DomainInstructions } from "@/modules/domains/domain.service";
import { listRegistrations, searchDomains, type DomainSearch } from "@/modules/domains/domain-registration.service";
import { getRegistrar } from "@/modules/domains/registrar";
import { canonicalStorefrontUrl } from "@/modules/tenant/storefront-url";
import { getBusinessEntitlements } from "@/modules/billing/subscription.service";
import { hasFeature } from "@/modules/billing/entitlements";
import { formatZAR } from "@/lib/utils";
import ActionButton from "@/components/ActionButton";
import ConfirmActionButton from "@/components/ConfirmActionButton";
import DashboardNav from "@/components/DashboardNav";
import TransferCodeButton from "./TransferCodeButton";
import {
  connectDomainAction,
  checkDomainAction,
  makePrimaryAction,
  removeDomainAction,
  startPurchaseAction,
  cancelPurchaseAction,
  simulatePaymentAction,
  setAutoRenewAction,
  getTransferCodeAction,
} from "./actions";
import styles from "./domains.module.css";

export const dynamic = "force-dynamic";

const REGISTRATION_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: "Waiting for payment",
  REGISTERING: "Registering…",
  REGISTERED: "Registered",
  RENEWAL_DUE: "Renewal due",
  EXPIRED: "Expired",
  TRANSFERRED_OUT: "Moved to another registrar",
  FAILED: "Needs attention",
  CANCELLED: "Cancelled",
};

function Step({ done, label, detail }: { done: boolean; label: string; detail?: string }) {
  return (
    <li className={styles.step} data-done={done ? "true" : "false"}>
      <span aria-hidden="true">{done ? "✓" : "○"}</span> {label}
      {detail && <span className={styles.stepDetail}> — {detail}</span>}
    </li>
  );
}

function Records({ title, records }: { title: string; records: { type: string; name: string; value: string }[] }) {
  if (records.length === 0) return null;
  return (
    <div className={styles.dnsBlock}>
      <p className={styles.dnsTitle}>{title}</p>
      {records.map((r) => (
        <div key={`${r.type}-${r.name}-${r.value}`} className={styles.dnsRecord}>
          <div className={styles.dnsRow}>
            <span className={styles.dnsLabel}>Type</span>
            <span className={styles.dnsValue}>{r.type}</span>
          </div>
          <div className={styles.dnsRow}>
            <span className={styles.dnsLabel}>Name</span>
            <span className={styles.dnsValue}>{r.name}</span>
          </div>
          <div className={styles.dnsRow}>
            <span className={styles.dnsLabel}>Value</span>
            <span className={styles.dnsValue}>{r.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function DomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; err?: string; connected?: string; quoted?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  let permitted = true;
  try {
    await requireStaffPermission("canManageDomains");
  } catch {
    permitted = false;
  }

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: session.tenantId },
    select: { name: true, slug: true, email: true, owner: { select: { email: true } } },
  });
  const planIncludesDomains = hasFeature(await getBusinessEntitlements(session.tenantId), "custom_domain");
  const domains = permitted ? await listDomains(session.tenantId) : [];
  const registrations = permitted ? await listRegistrations(session.tenantId) : [];
  const registrar = getRegistrar();
  const sandbox = registrar.key === "sandbox" && process.env.NODE_ENV !== "production";

  const instructions = new Map<string, DomainInstructions>();
  if (permitted) {
    await Promise.all(
      domains
        .filter((d) => d.status !== "ACTIVE")
        .map(async (d) => instructions.set(d.id, await getDomainDnsInstructions(session.tenantId, d.id))),
    );
  }

  const query = sp.q?.trim().slice(0, 80) ?? "";
  const search: DomainSearch | null = permitted && planIncludesDomains && query ? await searchDomains(session.tenantId, query) : null;

  const primary = domains.find((d) => d.isPrimary && d.status === "ACTIVE" && d.surface === "STOREFRONT");
  const currentAddress = canonicalStorefrontUrl(business.slug, "", primary?.hostname).replace(/^https?:\/\//, "");
  const freeAddress = canonicalStorefrontUrl(business.slug).replace(/^https?:\/\//, "");

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Website</span>
        <h1 className={styles.title}>Your web address</h1>

        <DashboardNav current="domains" {...workspaceContext} />
        <p className={styles.sub}>
          <Link href="/dashboard/settings">← Back to settings</Link>
        </p>

        <section className={`card ${styles.current}`}>
          <p className={styles.currentLabel}>Customers find you at</p>
          <p className={styles.currentAddress}>{currentAddress}</p>
          {primary && <p className={styles.sub}>Your free address {freeAddress} keeps working too.</p>}
        </section>

        {!permitted ? (
          <div className="errorBanner">Your role doesn&apos;t have permission to manage domains — ask the business owner.</div>
        ) : (
          <>
            {sp.err && <div className="errorBanner">{sp.err}</div>}
            {sp.connected && <div className="successBanner">Domain added. Follow the steps below — we&apos;ll switch it on once everything checks out.</div>}
            {sp.quoted && <div className="successBanner">Your domain is reserved for you while you pay.</div>}

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Get your own domain</h2>
              {!planIncludesDomains ? (
                <div className="card" style={{ padding: 16 }}>
                  Your own .co.za web address isn&apos;t included in your plan yet. Your free address keeps working either way.
                </div>
              ) : (
                <>
                  <form method="get" className={styles.searchForm} role="search">
                    <label className="label" htmlFor="q">
                      Search for a name
                    </label>
                    <div className={styles.searchRow}>
                      <input className="input" id="q" name="q" defaultValue={query || business.name} maxLength={80} />
                      <button type="submit" className="btn btnPrimary">
                        Search
                      </button>
                    </div>
                  </form>

                  {search && !search.offered && (
                    <p className={styles.sub}>Buying a domain through Skhokho isn&apos;t available yet. If you already own one, connect it below.</p>
                  )}
                  {search && search.offered && (
                    <ul className={styles.list}>
                      {search.results.map((r) => (
                        <li key={r.domain} className={`card ${styles.item}`}>
                          <div className={styles.itemHead}>
                            <span className={styles.itemName}>{r.domain}</span>
                            <span className={styles.statusBadge} data-status={r.available ? "ACTIVE" : "FAILED"}>
                              {r.available ? `${formatZAR((r.registerPriceCents ?? 0) / 100)} / year` : r.reason === "TAKEN" ? "Taken" : "Not available here"}
                            </span>
                          </div>
                          {r.available && (
                            <form action={startPurchaseAction} className={styles.buyForm}>
                              <input type="hidden" name="domain" value={r.domain} />
                              <p className={styles.sub}>
                                The domain is registered in <strong>your</strong> name — you own it and can move it to another registrar any time.
                              </p>
                              <div className={styles.row}>
                                <div className="field">
                                  <label className="label" htmlFor={`name-${r.domain}`}>
                                    Registrant (your full name)
                                  </label>
                                  <input className="input" id={`name-${r.domain}`} name="registrantName" required minLength={2} />
                                </div>
                                <div className="field">
                                  <label className="label" htmlFor={`email-${r.domain}`}>
                                    Registrant email
                                  </label>
                                  <input
                                    className="input"
                                    id={`email-${r.domain}`}
                                    name="registrantEmail"
                                    type="email"
                                    required
                                    defaultValue={business.owner?.email ?? business.email ?? ""}
                                  />
                                </div>
                                <div className="field">
                                  <label className="label" htmlFor={`years-${r.domain}`}>
                                    Years
                                  </label>
                                  <select className="input" id={`years-${r.domain}`} name="years" defaultValue="1">
                                    {[1, 2, 3].map((y) => (
                                      <option key={y} value={y}>
                                        {y}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <button type="submit" className="btn btnPrimary">
                                Get {r.domain}
                              </button>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  <form action={connectDomainAction} className={`card ${styles.connectForm}`}>
                    <h3 className={styles.subTitle}>Already own a domain? Connect it</h3>
                    <div className="field">
                      <label className="label" htmlFor="hostname">
                        Your domain
                      </label>
                      <input className="input" id="hostname" name="hostname" placeholder="kotatainment.co.za" required maxLength={253} />
                    </div>
                    <label className={styles.checkbox}>
                      <input type="checkbox" name="includePartner" defaultChecked /> Also connect the www. version
                    </label>
                    <button type="submit" className="btn">
                      Connect domain
                    </button>
                  </form>
                </>
              )}
            </section>

            {domains.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Your domains</h2>
                <ul className={styles.list}>
                  {domains.map((domain) => {
                    const how = instructions.get(domain.id);
                    const ownershipDone = domain.ownershipStatus === "VERIFIED";
                    return (
                      <li key={domain.id} className={`card ${styles.item}`}>
                        <div className={styles.itemHead}>
                          <div className={styles.itemInfo}>
                            <span className={styles.itemName}>{domain.hostname}</span>
                            <span className={styles.itemMeta}>
                              {domain.isPrimary && domain.status === "ACTIVE" ? "Main address" : domain.status === "ACTIVE" ? "Redirects to your main address" : ""}
                              {domain.registration ? " · bought through Skhokho" : ""}
                            </span>
                          </div>
                          <span className={styles.statusBadge} data-status={domain.status}>
                            {domain.status === "ACTIVE" ? "live" : domain.status === "FAILED" ? "stopped" : "setting up"}
                          </span>
                        </div>

                        <ol className={styles.steps}>
                          <Step done={ownershipDone} label="Prove you own it" detail={domain.verificationMethod === "REGISTRAR" ? "registered to you through Skhokho" : undefined} />
                          <Step done={domain.dnsStatus === "CONFIGURED"} label="Point it at Skhokho" />
                          <Step done={domain.sslStatus === "ISSUED"} label="Secure connection (HTTPS)" />
                          <Step done={domain.status === "ACTIVE"} label="Live" />
                        </ol>

                        {domain.lastError && domain.status !== "ACTIVE" && <p className={styles.sub}>{domain.lastError}</p>}
                        {domain.status === "ACTIVE" && domain.lastError && <p className="errorBanner">{domain.lastError}</p>}

                        {how?.ownership && <Records title="1. Add this record at your domain provider to prove it's yours" records={[how.ownership]} />}
                        {how && <Records title={`${how.ownership ? "2" : "1"}. Point your domain at Skhokho`} records={how.routing} />}

                        <div className={styles.itemActions}>
                          <ActionButton action={checkDomainAction.bind(null, domain.id)} className={styles.secondaryBtn} pendingLabel="Checking…">
                            Check now
                          </ActionButton>
                          {domain.status === "ACTIVE" && !domain.isPrimary && (
                            <ActionButton action={makePrimaryAction.bind(null, domain.id)} className={styles.secondaryBtn} pendingLabel="Saving…">
                              Make main address
                            </ActionButton>
                          )}
                          <ConfirmActionButton
                            action={removeDomainAction.bind(null, domain.id)}
                            className={styles.secondaryBtn}
                            confirmClassName="btn btnPrimary"
                            cancelClassName={styles.secondaryBtn}
                            label="Disconnect"
                            confirmLabel="Really disconnect?"
                            pendingLabel="Disconnecting…"
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {registrations.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Domains you bought</h2>
                <ul className={styles.list}>
                  {registrations.map((r) => (
                    <li key={r.id} className={`card ${styles.item}`}>
                      <div className={styles.itemHead}>
                        <span className={styles.itemName}>{r.domain}</span>
                        <span className={styles.statusBadge} data-status={r.status === "REGISTERED" ? "ACTIVE" : r.status === "FAILED" || r.status === "EXPIRED" ? "FAILED" : "PENDING"}>
                          {REGISTRATION_LABEL[r.status] ?? r.status}
                        </span>
                      </div>
                      <dl className={styles.facts}>
                        <div>
                          <dt>Registered to (you own it)</dt>
                          <dd>
                            {r.registrantName} · {r.registrantEmail}
                          </dd>
                        </div>
                        <div>
                          <dt>Managed through</dt>
                          <dd>{r.registrarKey === registrar.key ? registrar.name : r.registrarKey}</dd>
                        </div>
                        <div>
                          <dt>Price</dt>
                          <dd>
                            {formatZAR(r.priceCents / 100)} for {r.years} year{r.years === 1 ? "" : "s"}
                          </dd>
                        </div>
                        {r.expiresAt && (
                          <div>
                            <dt>Renews / expires</dt>
                            <dd>
                              {r.expiresAt.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })} · auto-renew {r.autoRenew ? "on" : "off"}
                            </dd>
                          </div>
                        )}
                      </dl>
                      {r.lastError && <p className={styles.sub}>{r.lastError}</p>}

                      <div className={styles.itemActions}>
                        {r.status === "AWAITING_PAYMENT" && (
                          <>
                            <span className={styles.sub}>Paying for domains through Skhokho is coming soon.</span>
                            {sandbox && (
                              <ActionButton action={simulatePaymentAction.bind(null, r.id)} className={styles.secondaryBtn} pendingLabel="Registering…">
                                Simulate payment (sandbox)
                              </ActionButton>
                            )}
                            <ActionButton action={cancelPurchaseAction.bind(null, r.id)} className={styles.secondaryBtn} pendingLabel="Cancelling…">
                              Cancel
                            </ActionButton>
                          </>
                        )}
                        {(r.status === "REGISTERED" || r.status === "RENEWAL_DUE") && (
                          <>
                            <ActionButton action={setAutoRenewAction.bind(null, r.id, !r.autoRenew)} className={styles.secondaryBtn} pendingLabel="Saving…">
                              Turn auto-renew {r.autoRenew ? "off" : "on"}
                            </ActionButton>
                            <TransferCodeButton action={getTransferCodeAction.bind(null, r.id)} className={styles.secondaryBtn} />
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
