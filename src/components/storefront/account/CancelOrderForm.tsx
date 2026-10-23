"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./Account.module.css";

/**
 * Cancel while the shop hasn't confirmed yet — reason first, then one tap.
 * The server decides whether it is still possible (/api/account/orders/
 * [id]/cancel); this only collects the reason and shows the server's words.
 */
export default function CancelOrderForm({
  businessId,
  orderId,
  orderNumber,
  reasons,
}: {
  businessId: string;
  orderId: string;
  orderNumber: string;
  reasons: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !reason) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/account/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, reason, note: note.trim() || undefined }),
      });
      const result = await res.json();
      if (result.ok) {
        setDone(true);
        router.refresh();
        return;
      }
      setError(result.message || "Could not cancel this order.");
    } catch {
      setError("Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className={styles.muted}>Order {orderNumber} is cancelled. The shop has been told.</p>;

  if (!open) {
    return (
      <button type="button" className="btn btnSecondary" onClick={() => setOpen(true)}>
        Cancel order
      </button>
    );
  }

  return (
    <form onSubmit={submit} className={styles.stack} aria-label={`Cancel order ${orderNumber}`}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Why are you cancelling?</span>
        <select className={`input ${styles.reasonSelect}`} value={reason} onChange={(e) => setReason(e.target.value)} required>
          <option value="">Choose a reason…</option>
          {reasons.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Anything the shop should know? (optional)</span>
        <input className="input" type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <div className="errorBanner" role="alert">{error}</div>}
      <div className={styles.actions}>
        <button type="submit" className="btn btnPrimary" disabled={busy || !reason}>
          {busy ? "Cancelling…" : "Yes, cancel this order"}
        </button>
        <button type="button" className="btn btnSecondary" onClick={() => setOpen(false)} disabled={busy}>
          Keep my order
        </button>
      </div>
    </form>
  );
}
