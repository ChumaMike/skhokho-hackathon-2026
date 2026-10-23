"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./Account.module.css";

/** Ends the customer session and returns to the shop. */
export default function SignOutButton({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={styles.linkButton}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/account/logout", { method: "POST" });
        } finally {
          router.push(returnTo);
          router.refresh();
        }
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
