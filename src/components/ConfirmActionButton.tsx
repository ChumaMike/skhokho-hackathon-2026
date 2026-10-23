"use client";

import { useState, useTransition } from "react";
import type React from "react";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * A destructive action button that requires a second click to confirm —
 * used for catalogue delete, in place of a native `confirm()` dialog
 * (blocking, ugly, and inconsistent with the rest of this app's inline
 * error/success banners).
 */
export default function ConfirmActionButton({
  action,
  className,
  confirmClassName,
  cancelClassName,
  label,
  confirmLabel = "Confirm",
  pendingLabel,
}: {
  action: () => Promise<ActionResult>;
  className?: string;
  confirmClassName?: string;
  cancelClassName?: string;
  label: React.ReactNode;
  confirmLabel?: string;
  pendingLabel?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
      }
    });
  }

  if (confirming) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button type="button" className={confirmClassName} onClick={handleConfirm} disabled={isPending}>
          {isPending && pendingLabel ? pendingLabel : confirmLabel}
        </button>
        <button
          type="button"
          className={cancelClassName}
          onClick={() => setConfirming(false)}
          disabled={isPending}
        >
          Cancel
        </button>
        {error && <p className="errorBanner">{error}</p>}
      </span>
    );
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setConfirming(true)}>
        {label}
      </button>
      {error && <p className="errorBanner">{error}</p>}
    </>
  );
}
