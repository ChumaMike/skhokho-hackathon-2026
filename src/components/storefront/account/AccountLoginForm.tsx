"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import viewStyles from "@/components/StorefrontView.module.css";
import styles from "./Account.module.css";
import { SIGNIN_TRIGGER_KEY } from "@/components/storefront/push/push-prompt";

type Step = { kind: "identifier" } | { kind: "code"; identifier: string; channel: "phone" | "email" };

/**
 * Two steps, one screen: number (or email) → code. Phone first because that
 * is what every customer has; email is the fallback when the deployment has
 * no phone provider yet, or when the customer prefers it. Everything is
 * verified server-side (/api/account/code, /api/account/verify) — this
 * component only moves between the two steps and shows the server's words.
 */
export default function AccountLoginForm({
  businessId,
  businessName,
  phoneAvailable,
  returnTo,
}: {
  businessId: string;
  businessName: string;
  /** Whether a phone provider is configured — decides the copy and the default field. */
  phoneAvailable: boolean;
  /** Where to go after sign-in (same-origin path, already validated by the page). */
  returnTo: string;
}) {
  const router = useRouter();
  const [useEmail, setUseEmail] = useState(!phoneAvailable);
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>({ kind: "identifier" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/account/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), businessId }),
      });
      const result = await res.json();
      if (result.ok) {
        setStep({ kind: "code", identifier: identifier.trim(), channel: result.channel });
        setNotice(result.channel === "phone" ? "We've sent a 6-digit code to your phone." : "We've emailed you a 6-digit code.");
        return;
      }
      if (result.code === "PHONE_UNAVAILABLE") setUseEmail(true);
      setError(result.message || "Something went wrong. Try again.");
    } catch {
      setError("Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (busy || step.kind !== "code") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: step.identifier, code: code.trim() }),
      });
      const result = await res.json();
      if (result.ok) {
        try {
          // The account page offers order updates on this phone once, right after a sign-in — never on a plain visit.
          sessionStorage.setItem(SIGNIN_TRIGGER_KEY, "1");
        } catch {
          // Storage off: no offer this time, nothing else changes.
        }
        router.push(returnTo);
        router.refresh();
        return;
      }
      setError(result.message || "That code isn't right.");
      if (result.code === "EXPIRED" || result.code === "LOCKED" || result.code === "NONE") {
        setStep({ kind: "identifier" });
        setCode("");
      }
    } catch {
      setError("Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === "code") {
    return (
      <form onSubmit={verify} noValidate className={styles.stack}>
        <p className={styles.lede}>
          {step.channel === "phone" ? "Enter the code we sent to " : "Enter the code we emailed to "}
          <strong>{step.identifier}</strong>.
        </p>
        {notice && <div className="successBanner">{notice}</div>}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>6-digit code</span>
          <input
            className={`input ${styles.codeInput}`}
            type="text"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoFocus
            required
          />
        </label>
        {error && <div className="errorBanner" role="alert">{error}</div>}
        <button type="submit" className={`btn ${viewStyles.storeActionPrimary}`} disabled={busy || code.length < 6}>
          {busy ? "Checking…" : "Sign in"}
        </button>
        <div className={styles.row}>
          <button type="button" className={styles.linkButton} onClick={() => requestCode()} disabled={busy}>
            Send a new code
          </button>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              setStep({ kind: "identifier" });
              setCode("");
              setNotice(null);
              setError(null);
            }}
          >
            Use a different {step.channel === "phone" ? "number" : "email"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={requestCode} noValidate className={styles.stack}>
      <p className={styles.lede}>
        {useEmail ? "We'll email you a code to sign in." : "We'll text a code to your phone. No password needed."}
      </p>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{useEmail ? "Email address" : "WhatsApp / phone number"}</span>
        <input
          className="input"
          type={useEmail ? "email" : "tel"}
          name="identifier"
          inputMode={useEmail ? "email" : "tel"}
          autoComplete={useEmail ? "email" : "tel"}
          placeholder={useEmail ? "you@example.co.za" : "082 123 4567"}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
        />
      </label>
      {error && <div className="errorBanner" role="alert">{error}</div>}
      <button type="submit" className={`btn ${viewStyles.storeActionPrimary}`} disabled={busy || !identifier.trim()}>
        {busy ? "Sending…" : "Send me a code"}
      </button>
      {phoneAvailable && (
        <button type="button" className={styles.linkButton} onClick={() => setUseEmail((v) => !v)}>
          {useEmail ? "Use my phone number instead" : "Use my email instead"}
        </button>
      )}
      <p className={styles.muted}>
        Signing in shows you your orders and rewards at {businessName}. We only use your number to run your account here.
      </p>
    </form>
  );
}
