import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import DashboardNav from "@/components/DashboardNav";
import ActionButton from "@/components/ActionButton";
import ConfirmActionButton from "@/components/ConfirmActionButton";
import PasswordField from "@/components/PasswordField";
import { Modal } from "@/components/ui/Modal";
import { listConnections, type ConnectionView } from "@/modules/payments/payment-connection.service";
import { listOpenRefunds, type OpenRefund } from "@/modules/payments/refund-resolution.service";
import { formatZAR } from "@/lib/utils";
import { currentKeyVersion } from "@/lib/crypto/secret-box";
import {
  saveConnectionAction,
  setEnabledAction,
  disconnectAction,
  startVerificationAction,
  markRefundResolvedAction,
  setCustomerPaymentModeAction,
} from "./actions";
import { prisma } from "@/lib/prisma/client";
import { customerPaymentMode, type CustomerPaymentMode } from "@/modules/orders/checkout-payment";
import styles from "./payments.module.css";

export const dynamic = "force-dynamic";

/**
 * Where an owner connects their OWN payment account.
 *
 * Skhokho never receives a merchant's customer payments: money settles
 * directly to the account connected here. Nothing on this page ever renders a
 * stored secret — the merchant ID is masked, and a saved passphrase is shown
 * only as "set", never as a value.
 */

const STATUS_LABEL: Record<string, string> = {
  PENDING_VERIFICATION: "not verified yet",
  VERIFIED: "ready",
  INVALID: "needs attention",
  DISABLED: "switched off",
  SUPERSEDED: "replaced",
};

function ConnectionCard({ connection }: { connection: ConnectionView }) {
  const isLive = connection.environment === "LIVE";
  const verified = connection.status === "VERIFIED";

  return (
    <li className={`card ${styles.item}`}>
      <div className={styles.itemHead}>
        <div className={styles.itemInfo}>
          <span className={styles.itemName}>
            {isLive ? "Live account" : "Test account (sandbox)"}
          </span>
          <span className={styles.itemMeta}>
            Merchant <span className="mono">{connection.merchantIdMasked}</span>
            {connection.hasPassphrase ? " · passphrase set" : " · no passphrase"}
            {connection.verifiedAt
              ? ` · verified ${connection.verifiedAt.toLocaleDateString("en-ZA")}`
              : ""}
          </span>
        </div>
        <span className={styles.statusBadge} data-status={connection.status}>
          {STATUS_LABEL[connection.status] ?? connection.status.toLowerCase()}
        </span>
      </div>

      {connection.lastError && <p className={styles.itemError}>{connection.lastError}</p>}

      {!verified && connection.status !== "DISABLED" && (
        <p className={styles.itemMeta}>
          {isLive
            ? "Saved, but not yet proven able to receive money. Card payments stay off until it is."
            : "Run a test payment to prove the connection works. No real money moves."}
        </p>
      )}

      <div className={styles.itemActions}>
        {!verified && (
          <ActionButton
            action={startVerificationAction.bind(null, connection.environment)}
            className={styles.secondaryBtn}
            pendingLabel="Starting…"
          >
            {isLive ? "Verify live account" : "Run test payment"}
          </ActionButton>
        )}
        {verified && (
          <ActionButton
            action={setEnabledAction.bind(null, connection.environment, false)}
            className={styles.secondaryBtn}
            pendingLabel="Switching off…"
          >
            Switch off
          </ActionButton>
        )}
        {connection.status === "DISABLED" && (
          <ActionButton
            action={setEnabledAction.bind(null, connection.environment, true)}
            className={styles.secondaryBtn}
            pendingLabel="Switching on…"
          >
            Switch back on
          </ActionButton>
        )}
        <ConfirmActionButton
          action={disconnectAction.bind(null, connection.environment)}
          className={styles.secondaryBtn}
          label="Disconnect"
          confirmLabel="Really disconnect?"
          pendingLabel="Disconnecting…"
        />
      </div>
    </li>
  );
}

function ConnectForm({ environment }: { environment: "SANDBOX" | "LIVE" }) {
  const isLive = environment === "LIVE";
  return (
    <form action={saveConnectionAction} className={styles.modalForm}>
      <input type="hidden" name="environment" value={environment} />
      <p className={styles.formHint}>
        {isLive
          ? "From your PayFast dashboard under Settings → Integration. These are your live account's details — money paid on your storefront goes straight to this account."
          : "From your PayFast sandbox account. Use this first to prove everything works without moving real money."}
      </p>

      <div className="field">
        <label className="label" htmlFor={`merchantId-${environment}`}>
          Merchant ID
        </label>
        <input
          className="input"
          id={`merchantId-${environment}`}
          name="merchantId"
          inputMode="numeric"
          autoComplete="off"
          required
        />
      </div>

      {/* Secrets go through PasswordField so they can be revealed while
          typing — the commonest cause of a failed connection is a mistyped or
          part-pasted key. It has no defaultValue, which is exactly right:
          a stored secret is never rendered back into a form. */}
      <PasswordField
        id={`merchantKey-${environment}`}
        name="merchantKey"
        label="Merchant Key"
        autoComplete="off"
        required
      />

      <PasswordField
        id={`passphrase-${environment}`}
        name="passphrase"
        label={isLive ? "Security passphrase (required)" : "Security passphrase (if you set one)"}
        autoComplete="off"
        required={isLive}
        minLength={isLive ? 8 : undefined}
      />

      <p className={styles.formHint}>
        {isLive
          ? "A passphrase is required for a live account. Set one in PayFast under Settings → Security, then paste it here — it is what proves a payment notification really came from PayFast."
          : "Sandbox accounts often have none. Leave it blank if you have not set one."}
      </p>

      <button type="submit" className="btn btnPrimary">
        Save {isLive ? "live" : "test"} details
      </button>
    </form>
  );
}

export default async function PaymentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; err?: string; verifying?: string; refunded?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  // A session already exists — the only thing that matters here is whether
  // this person may change where the business's money is sent.
  let permitted = true;
  try {
    await requireStaffPermission("canManageBilling");
  } catch {
    permitted = false;
  }

  const connections = permitted ? await listConnections(session.tenantId) : [];
  const openRefunds = permitted ? await listOpenRefunds(session.tenantId) : [];
  // How customers may pay once card is live — read from the same settings
  // JSON checkout reads (checkout-payment.ts), so the page and the checkout
  // can never disagree.
  const businessRow = permitted ? await prisma.business.findUnique({ where: { id: session.tenantId }, select: { settings: true } }) : null;
  const paymentMode: CustomerPaymentMode = businessRow ? customerPaymentMode(businessRow) : "CARD_OR_IN_PERSON";
  const PAYMENT_MODES: { value: CustomerPaymentMode; label: string; hint: string }[] = [
    { value: "CARD_OR_IN_PERSON", label: "Card or in person — the customer chooses", hint: "Card now on your storefront, or cash/card when they collect or the driver arrives." },
    { value: "CARD_ONLY", label: "Card only", hint: "Every storefront order is paid before you start on it. Needs your live account verified." },
    { value: "IN_PERSON_ONLY", label: "In person only", hint: "No card step on the storefront, even with a live account connected." },
  ];

  // Credentials cannot be stored without an encryption key. Checked on load so
  // an owner is told before filling in a form, rather than after submitting one.
  let canStoreCredentials = true;
  try {
    currentKeyVersion();
  } catch {
    canStoreCredentials = false;
  }
  const sandbox = connections.find((c) => c.environment === "SANDBOX");
  const live = connections.find((c) => c.environment === "LIVE");
  const sandboxProven = sandbox?.status === "VERIFIED" || sandbox?.verifiedAt != null;

  return (
    <div className="shell">
      <div className="consoleChrome">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Get paid online</h1>
        <p className={styles.sub}>
          Connect your own PayFast account so customers pay your business directly. Skhokho never
          holds your money.
        </p>

        <DashboardNav current="payments" {...workspaceContext} />
        <p className={styles.sub}>
          <Link href="/dashboard/settings">← Back to settings</Link>
        </p>

        {!permitted ? (
          <div className="errorBanner">
            Only the business owner can change where payments go — ask them to set this up.
          </div>
        ) : (
          <>
            {sp.saved && <div className="successBanner">Saved. Verify the account to switch card payments on.</div>}
            {sp.verifying === "1" && (
              <div className="successBanner">
                Payment sent. Verification completes when PayFast confirms it — refresh in a moment.
              </div>
            )}
            {sp.refunded === "1" && <div className="successBanner">Refund recorded. Thanks — that closes it on our side too.</div>}
            {sp.err && <div className="errorBanner">{sp.err}</div>}
            {openRefunds.length > 0 && <RefundsSection refunds={openRefunds} />}
            {!canStoreCredentials && (
              <div className="errorBanner">
                Connecting a payment account isn&apos;t available right now — this is a
                configuration problem on our side, not anything you&apos;ve done. Your storefront
                keeps taking orders, and customers pay you on collection or delivery meanwhile.
              </div>
            )}

            <ol className={styles.steps}>
              <li data-done={Boolean(sandbox)}>Connect your test account</li>
              <li data-done={sandboxProven}>Prove it works with a test payment</li>
              <li data-done={Boolean(live)}>Add your live account details</li>
              <li data-done={live?.status === "VERIFIED"}>Verify the live account</li>
            </ol>

            {connections.length === 0 ? (
              <div className={`card ${styles.empty}`}>
                <p>
                  No payment account connected. Until one is, your storefront takes orders and
                  customers pay you on collection or delivery — which keeps working either way.
                </p>
              </div>
            ) : (
              <ul className={styles.list}>
                {connections.map((c) => (
                  <ConnectionCard key={c.id} connection={c} />
                ))}
              </ul>
            )}

            <div className={styles.addRow} hidden={!canStoreCredentials}>
              <Modal
                trigger={sandbox ? "Replace test details" : "+ Connect test account"}
                triggerClassName={styles.addToggle}
                title="Connect your PayFast sandbox"
              >
                <ConnectForm environment="SANDBOX" />
              </Modal>
              <Modal
                trigger={live ? "Replace live details" : "+ Connect live account"}
                triggerClassName={styles.addToggle}
                title="Connect your live PayFast account"
              >
                <ConnectForm environment="LIVE" />
              </Modal>
            </div>

            <section className={styles.note} aria-labelledby="customer-pay-heading">
              <h2 id="customer-pay-heading" className={styles.noteTitle}>How customers pay</h2>
              {sp.saved === "mode" && <div className="successBanner">Saved.</div>}
              <form action={setCustomerPaymentModeAction} className="field">
                {PAYMENT_MODES.map((m) => (
                  <label key={m.value} className="label" style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: 44 }}>
                    <input type="radio" name="mode" value={m.value} defaultChecked={paymentMode === m.value} />
                    <span>
                      {m.label}
                      <br />
                      <small>{m.hint}</small>
                    </span>
                  </label>
                ))}
                <button type="submit" className="btn btnSecondary">
                  Save how customers pay
                </button>
              </form>
              <p>Until your live account is verified, every storefront order is paid in person whatever you choose here.</p>
            </section>

            <section className={styles.note}>
              <h2 className={styles.noteTitle}>What Skhokho does and does not do</h2>
              <ul className={styles.noteList}>
                <li>
                  Money from your storefront settles to your own PayFast account. Skhokho never
                  receives it and never takes a cut of a sale.
                </li>
                <li>
                  PayFast — not Skhokho — verifies your business and your settlement bank account.
                </li>
                <li>
                  <strong>Refunds happen in your own PayFast dashboard</strong>, against the
                  original transaction. Skhokho cannot refund a payment it never held.
                </li>
                <li>
                  Replacing your details keeps the old ones on file, so a payment already in
                  progress still completes correctly.
                </li>
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Money the business holds that must go back to a customer (REFUND_DUE
 * attempts with no resolution yet). The refund itself is made in PayFast;
 * this records that it was done so the row stops showing as owed.
 */
function RefundsSection({ refunds }: { refunds: OpenRefund[] }) {
  return (
    <section id="refunds" className={styles.note} style={{ marginBottom: 16 }}>
      <h2 className={styles.noteTitle}>Refunds to make ({refunds.length})</h2>
      <p className={styles.sub}>
        These payments reached your PayFast account but could not be applied to an order. Refund each one in your
        PayFast dashboard against the original transaction, then mark it done here.
      </p>
      <ul className={styles.list}>
        {refunds.map((r) => (
          <li key={r.attemptId} className={`card ${styles.item}`}>
            <div className={styles.itemHead}>
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>
                  {formatZAR(r.expectedAmount)}
                  {r.orderNumber ? ` · order ${r.orderNumber}` : ""}
                  {r.environment === "SANDBOX" ? " · test account" : ""}
                </span>
                <span className={styles.itemMeta}>
                  PayFast payment <span className="mono">{r.providerPaymentId ?? "—"}</span>
                  {r.verifiedAt ? ` · received ${r.verifiedAt.toLocaleDateString("en-ZA")}` : ""}
                </span>
                {r.reason && <span className={styles.itemMeta}>{r.reason}</span>}
              </div>
            </div>
            <form action={markRefundResolvedAction.bind(null, r.attemptId)} className={styles.modalForm}>
              <div className="field">
                <label className="label" htmlFor={`reason-${r.attemptId}`}>
                  What happened
                </label>
                <input
                  className="input"
                  id={`reason-${r.attemptId}`}
                  name="reason"
                  required
                  minLength={5}
                  maxLength={500}
                  placeholder="Refunded in PayFast on 21 Oct"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor={`ref-${r.attemptId}`}>
                  PayFast refund reference (if you have it)
                </label>
                <input className="input" id={`ref-${r.attemptId}`} name="providerRefundRef" maxLength={100} />
              </div>
              <button type="submit" className="btn btnPrimary">
                Mark refunded
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
