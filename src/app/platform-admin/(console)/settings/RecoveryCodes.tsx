"use client";

import { useState } from "react";

/** Replace your own recovery codes (needs a current authenticator code). Shown once. */
export default function RecoveryCodes() {
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (codes) {
    return (
      <div>
        <p><strong>New recovery codes — save them now.</strong> The old ones no longer work.</p>
        <pre style={{ userSelect: "all" }}>{codes.join("\n")}</pre>
      </div>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await fetch("/api/admin/mfa/recovery-codes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
          const json = await res.json().catch(() => null);
          if (!json?.ok) throw new Error(json?.error ?? "Something went wrong.");
          setCodes(json.recoveryCodes);
        } catch (err) {
          setError((err as Error).message);
          setCode("");
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
    >
      {error && <p className="errorBanner" style={{ width: "100%" }}>{error}</p>}
      <input className="input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="Current 6-digit code" maxLength={7} required style={{ maxWidth: 200 }} />
      <button type="submit" className="btn" disabled={busy}>Replace my recovery codes</button>
    </form>
  );
}
