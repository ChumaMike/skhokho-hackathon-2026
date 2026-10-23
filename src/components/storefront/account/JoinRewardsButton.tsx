"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./Account.module.css";

/** "Start my rewards card here" — Consent 1 for THIS shop, one tap, then the page re-renders with the card. */
export default function JoinRewardsButton({ businessId, businessName }: { businessId: string; businessName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={styles.stack}>
      <p className={styles.muted}>
        Want a rewards card at {businessName}? We&apos;ll save your visits here so you can earn free stuff. We keep your number to run your card — that&apos;s it. You can leave any time.
      </p>
      <button
        type="button"
        className="btn btnPrimary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/account/rewards/join", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ businessId }),
            });
            const result = await res.json();
            if (result.ok) {
              router.refresh();
              return;
            }
            setError(result.message || "Could not open your rewards card.");
          } catch {
            setError("Check your connection and try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening your card…" : "Yes, start my rewards card"}
      </button>
      {error && <div className="errorBanner" role="alert">{error}</div>}
    </div>
  );
}
