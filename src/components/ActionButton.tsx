"use client";

import { useState, useTransition } from "react";
import type React from "react";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * One button, one server action, pending/error state — the same shape
 * StampCard.tsx already hand-rolls for stamp/redeem. Pulled out once a
 * third dashboard section (orders, appointments, catalogue) needed the
 * identical pattern rather than a third copy of it.
 */
export default function ActionButton({
  action,
  className,
  pendingLabel,
  children,
}: {
  action: () => Promise<ActionResult>;
  className?: string;
  pendingLabel?: string;
  children: React.ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      <button type="button" className={className} onClick={handleClick} disabled={isPending}>
        {isPending && pendingLabel ? pendingLabel : children}
      </button>
      {error && <p className="errorBanner" role="alert">{error}</p>}
    </>
  );
}
