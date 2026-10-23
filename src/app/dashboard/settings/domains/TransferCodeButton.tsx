"use client";

import { useState, useTransition } from "react";

/**
 * Reveals a domain's transfer code in place — fetched on demand from the
 * registrar, shown once, never put in a URL or stored.
 */
export default function TransferCodeButton({
  action,
  className,
}: {
  action: () => Promise<{ ok: true; code: string } | { ok: false; error: string }>;
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (code) {
    return (
      <p role="status">
        Transfer code: <code style={{ fontFamily: "var(--font-mono)", userSelect: "all" }}>{code}</code>
        <br />
        Give this to your new registrar to move the domain. Keep it private.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await action();
            if (result.ok) setCode(result.code);
            else setError(result.error);
          })
        }
      >
        {isPending ? "Getting code…" : "Move to another registrar"}
      </button>
      {error && (
        <p className="errorBanner" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
