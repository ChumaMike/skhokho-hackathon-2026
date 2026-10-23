"use client";

import { useState } from "react";

type Setup = { otpauthUri: string; secret: string; qrSvg: string };

async function post(url: string, body: unknown = {}) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!json?.ok) throw new Error(json?.error ?? "Something went wrong.");
  return json;
}

/** Enrol (QR → confirm → recovery codes) or verify (code / recovery code). Codes never leave this form except to the server. */
export default function MfaForm({ mode }: { mode: "enroll" | "verify" }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [next, setNext] = useState("/");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div>
        <p>
          <strong>Save these recovery codes now.</strong> Each works once if you lose your phone. They won&apos;t be shown again.
        </p>
        <pre style={{ fontSize: "1.05rem", lineHeight: 1.7, userSelect: "all" }}>{recoveryCodes.join("\n")}</pre>
        <a className="btn btnPrimary btnBlock" href={next}>I&apos;ve saved them — continue</a>
      </div>
    );
  }

  const codeInput = (
    <div className="field">
      <label className="label" htmlFor="code">{useRecovery ? "Recovery code" : "6-digit code"}</label>
      <input
        className="input"
        id="code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode={useRecovery ? "text" : "numeric"}
        autoComplete="one-time-code"
        maxLength={useRecovery ? 20 : 7}
        required
        autoFocus
      />
    </div>
  );

  return (
    <div>
      {error && <div className="errorBanner" role="alert">{error}</div>}

      {mode === "enroll" && !setup && (
        <button type="button" className="btn btnPrimary btnBlock" disabled={busy} onClick={() => run(async () => setSetup(await post("/api/admin/mfa/enroll")))}>
          Set up my authenticator
        </button>
      )}

      {mode === "enroll" && setup && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await post("/api/admin/mfa/confirm", { code });
              setNext(r.next);
              setRecoveryCodes(r.recoveryCodes);
            });
          }}
        >
          <p>Scan this with your authenticator app:</p>
          <div style={{ maxWidth: 220 }} dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
          <p>
            Or enter this key by hand: <code style={{ userSelect: "all", wordBreak: "break-all" }}>{setup.secret}</code>
          </p>
          {codeInput}
          <button type="submit" className="btn btnPrimary btnBlock" disabled={busy}>Confirm</button>
        </form>
      )}

      {mode === "verify" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await post("/api/admin/mfa/verify", useRecovery ? { recoveryCode: code } : { code });
              window.location.assign(r.next);
            });
          }}
        >
          {codeInput}
          <button type="submit" className="btn btnPrimary btnBlock" disabled={busy}>Sign in</button>
          <button type="button" className="btn btnBlock" style={{ marginTop: 8 }} onClick={() => { setUseRecovery(!useRecovery); setCode(""); }}>
            {useRecovery ? "Use my authenticator code" : "Lost your phone? Use a recovery code"}
          </button>
        </form>
      )}
    </div>
  );
}
