"use client";

import { useEffect, useState } from "react";
import styles from "@/components/storefront/account/Account.module.css";
import { applicationServerKey, decidePrompt, promptCopy, promptStorageKey, SIGNIN_TRIGGER_KEY, type PromptDecision, type PushTrigger } from "./push-prompt";

/**
 * The once-only "get order updates on this phone" offer. Rendered by the
 * order confirmation page (trigger "order", right after checkout) and the
 * account page (trigger "signin", only when the login form just set the
 * session flag). It decides client-side whether to show anything at all —
 * see push-prompt.ts — and remembers the customer's answer per shop.
 *
 * Saying yes asks the browser for permission, subscribes with this
 * deployment's public key, and stores the subscription against the
 * customer's membership at THIS shop (by order id or signed-in session).
 * Nothing is stored before the browser has actually said yes.
 */
export default function PushPrompt({
  publicKey,
  businessId,
  businessName,
  trigger,
  orderId,
}: {
  /** Null when Web Push isn't configured: the component renders nothing. */
  publicKey: string | null;
  businessId: string;
  businessName: string;
  trigger: PushTrigger;
  /** The order the browser just placed (trigger "order"); the session identifies the customer otherwise. */
  orderId?: string;
}) {
  const [decision, setDecision] = useState<PromptDecision>("hidden");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | "on" | "blocked" | "failed">(null);

  useEffect(() => {
    if (!publicKey) return;
    // Sign-in trigger: only when the login form just set the flag, and only once.
    if (trigger === "signin") {
      let flagged = false;
      try {
        flagged = sessionStorage.getItem(SIGNIN_TRIGGER_KEY) === "1";
        if (flagged) sessionStorage.removeItem(SIGNIN_TRIGGER_KEY);
      } catch {
        flagged = false;
      }
      if (!flagged) return;
    }
    let answered = false;
    try {
      answered = localStorage.getItem(promptStorageKey(businessId)) !== null;
    } catch {
      answered = false;
    }
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const permission = supported ? Notification.permission : "denied";

    const settle = (subscribed: boolean) =>
      setDecision(decidePrompt({ configured: true, supported, permission, ios, standalone, answered, subscribed }));

    if (!supported) {
      settle(false);
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => settle(sub !== null))
      .catch(() => settle(false));
  }, [publicKey, businessId, trigger]);

  if (decision === "hidden" || !publicKey) return null;
  const copy = promptCopy(trigger, businessName, decision);

  function remember(answer: "yes" | "no") {
    try {
      localStorage.setItem(promptStorageKey(businessId), answer);
    } catch {
      // Storage off: the offer may come back next time, which is the honest fallback.
    }
  }

  async function sayYes() {
    if (busy || !publicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        remember("no");
        setDone("blocked");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) }));
      const res = await fetch("/api/account/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, orderId: orderId ?? null, subscription: sub.toJSON() }),
      });
      const result = await res.json().catch(() => ({ ok: false }));
      if (result.ok) {
        remember("yes");
        setDone("on");
      } else {
        setDone("failed");
      }
    } catch {
      setDone("failed");
    } finally {
      setBusy(false);
    }
  }

  function sayNo() {
    remember("no");
    setDecision("hidden");
  }

  if (done === "on") {
    return (
      <div className={styles.card} role="status">
        <p className={styles.lede}>Done — we&apos;ll tell you on this phone when your order moves.</p>
        <p className={styles.muted}>You can switch it off any time from your account at {businessName}.</p>
      </div>
    );
  }
  if (done === "blocked") {
    return (
      <div className={styles.card} role="status">
        <p className={styles.muted}>No problem — we won&apos;t ask again here. Your order updates still come by text or email.</p>
      </div>
    );
  }
  if (done === "failed") {
    return (
      <div className={styles.card} role="status">
        <p className={styles.muted}>That didn&apos;t work on this phone right now. Your order updates still come by text or email.</p>
      </div>
    );
  }

  return (
    <div className={styles.card} role="region" aria-label={copy.heading}>
      <p className={styles.lede}>{copy.heading}</p>
      <p className={styles.muted}>{copy.body}</p>
      <div className={styles.actions}>
        {copy.yes && (
          <button type="button" className="btn btnPrimary" onClick={sayYes} disabled={busy}>
            {busy ? "Setting up…" : copy.yes}
          </button>
        )}
        <button type="button" className="btn btnSecondary" onClick={sayNo} disabled={busy}>
          {copy.no}
        </button>
      </div>
    </div>
  );
}
