import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerSession } from "../../../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import { formatZAR } from "@/lib/utils";
import { getInvoiceForBusiness } from "@/modules/billing/invoice.service";
import { vatMode, invoiceDocumentTitle, vatRateLabel } from "@/modules/billing/vat";
import {
  ISSUER_DISPLAY,
  bankDetails,
  issuerAddress,
  issuerRegistrationNumber,
} from "@/modules/billing/issuer";
import styles from "./invoice.module.css";

export const dynamic = "force-dynamic";

/**
 * One invoice, laid out to be read on a phone and to print or "Save as PDF"
 * cleanly — which is how an owner actually gets a copy for their bookkeeper.
 * No PDF library: the browser's own print-to-PDF produces a better document
 * than a hand-rolled renderer, and adds no dependency.
 *
 * VAT renders in whichever mode is configured (modules/billing/vat.ts). When
 * Skhokho Laboratory is not VAT registered there is no VAT line, no VAT
 * number, and the heading is "Invoice" rather than "Tax Invoice" — the label
 * and the number come from the same switch, so a non-compliant tax invoice
 * cannot be produced by accident.
 */

const LINE_KIND_LABEL: Record<string, string> = {
  PLAN: "Plan",
  ADDON: "Service",
  SETUP: "Setup",
  PRORATION: "Adjustment",
  CREDIT: "Credit",
};

function dateLabel(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const session = await requireOwnerSession();
  // Same gate as the plan page: billing is the owner's business, not a
  // cashier's. An invoice is also commercially sensitive.
  try {
    await requireStaffPermission("canManageBilling");
  } catch {
    notFound();
  }

  // Scoped by businessId, so one business can never read another's invoice
  // even with a valid id.
  const invoice = await getInvoiceForBusiness(session.tenantId, invoiceId);
  if (!invoice) notFound();

  const business = await prisma.business.findUnique({
    where: { id: session.tenantId },
    select: { name: true, address: true, suburb: true, city: true, province: true, postalCode: true },
  });

  const mode = vatMode();
  const bank = bankDetails();
  const address = issuerAddress();
  const registration = issuerRegistrationNumber();
  const billedTo = [business?.address, business?.suburb, business?.city, business?.province, business?.postalCode]
    .filter(Boolean)
    .join(", ");

  return (
    <main className={styles.page}>
      <div className={styles.noPrint}>
        <Link href="/dashboard/settings/plan">← Back to your plan</Link>
      </div>

      <article className={styles.doc}>
        <header className={styles.head}>
          <div>
            <h1 className={styles.docTitle}>{invoiceDocumentTitle(mode)}</h1>
            <p className={styles.number}>{invoice.number ?? "—"}</p>
          </div>
          <div className={styles.issuer}>
            <p className={styles.issuerName}>{ISSUER_DISPLAY}</p>
            {address && <p className={styles.issuerLine}>{address}</p>}
            {registration && <p className={styles.issuerLine}>Reg. {registration}</p>}
            {mode.registered && <p className={styles.issuerLine}>VAT no. {mode.vatNumber}</p>}
          </div>
        </header>

        <section className={styles.meta}>
          <div>
            <p className={styles.metaLabel}>Billed to</p>
            <p className={styles.metaValue}>{business?.name ?? "—"}</p>
            {billedTo && <p className={styles.metaSmall}>{billedTo}</p>}
          </div>
          <div>
            <p className={styles.metaLabel}>Issued</p>
            <p className={styles.metaValue}>{dateLabel(invoice.issuedAt)}</p>
            <p className={styles.metaLabel}>Due</p>
            <p className={styles.metaValue}>{dateLabel(invoice.dueAt)}</p>
          </div>
          <div>
            <p className={styles.metaLabel}>Period</p>
            <p className={styles.metaValue}>
              {dateLabel(invoice.periodStart)} — {dateLabel(invoice.periodEnd)}
            </p>
            {invoice.paidAt && (
              <>
                <p className={styles.metaLabel}>Paid</p>
                <p className={styles.metaValue}>{dateLabel(invoice.paidAt)}</p>
              </>
            )}
          </div>
        </section>

        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col" className={styles.num}>
                Qty
              </th>
              <th scope="col" className={styles.num}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <span className={styles.lineKind}>{LINE_KIND_LABEL[line.kind] ?? line.kind}</span>
                  {line.description}
                </td>
                <td className={styles.num}>{line.quantity}</td>
                <td className={styles.num}>{formatZAR(line.amountCents / 100)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {/* A VAT line only in registered mode. Not registered means the
                total IS the subtotal and no VAT is shown or implied. */}
            {mode.registered && (
              <>
                <tr>
                  <td colSpan={2}>Subtotal</td>
                  <td className={styles.num}>{formatZAR(invoice.subtotalCents / 100)}</td>
                </tr>
                <tr>
                  <td colSpan={2}>VAT {vatRateLabel(mode)}</td>
                  <td className={styles.num}>{formatZAR(invoice.vatCents / 100)}</td>
                </tr>
              </>
            )}
            <tr className={styles.totalRow}>
              <td colSpan={2}>Total</td>
              <td className={styles.num}>{formatZAR(invoice.totalCents / 100)}</td>
            </tr>
          </tfoot>
        </table>

        <section className={styles.pay}>
          <h2 className={styles.payTitle}>How to pay</h2>
          {bank ? (
            <dl className={styles.bank}>
              <dt>Bank</dt>
              <dd>{bank.bankName}</dd>
              <dt>Account name</dt>
              <dd>{bank.accountName}</dd>
              <dt>Account number</dt>
              <dd>{bank.accountNumber}</dd>
              <dt>Branch code</dt>
              <dd>{bank.branchCode}</dd>
              <dt>Reference</dt>
              <dd>
                <strong>{invoice.number ?? "—"}</strong>
              </dd>
            </dl>
          ) : (
            <p className={styles.metaSmall}>
              Reply to your invoice email and we&apos;ll send you the payment details.
            </p>
          )}
          <p className={styles.metaSmall}>
            Please use the invoice number as your payment reference so we can match it up.
          </p>
        </section>

        <footer className={styles.footer}>
          <p>
            Issued by {ISSUER_DISPLAY}. This invoice is for your Skhokho plan and any services you
            have with us. It is separate from the payments your own customers make to you, which go
            directly into your own account.
          </p>
        </footer>
      </article>
    </main>
  );
}
