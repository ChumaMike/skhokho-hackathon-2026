"use client";

import { useEffect, useState } from "react";
import styles from "@/components/storefront/account/Account.module.css";
import { applicationServerKey } from "./push-prompt";

type ThisPhone = "checking" | "unsupported" | "off" | "on";

/**
 * "Order updates on this phone" on the account page: what this browser is
 * doing (read from the browser itself, never guessed from the server),
 * which other devices the customer switched on at this shop (labels only),
 * and the switches — off on this phone, off everywhere here, or on.
 *
 * Switching off always works, even if the deployment has since lost its
 * keys: the browser's own subscription is dropped first, then the server's
 * row. Switching on is the same flow as the once-only offer, minus the
 * "once": from here the customer asked for it.
 */
export default function PushSettings({
  publicKey,
  businessId,
  businessName,
  devices,
}: {
  /** Null when Web Push is not configured: only "switch off" remains, in case anything is still stored. */
  publicKey: string | null;
  businessId: string;
  businessName: string;
  /** This membership's switched-on browsers, labels only (push-subscriptions.service). */
  devices: { id: string; deviceLabel: string }[];
}) {
  const [thisPhone, setThisPhone] = useState<ThisPhone>("checking");
  const [count, setCount] = useState(devices.length);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Read what this browser is doing, then settle — one state change, after the check, never during render.
    const supported = "serviceWorker" in navigator && "PushManager" in window;
    const check: Promise<ThisPhone> = supported
      ? navigator.serviceWorker
          .getRegistration("/")
          .then((reg) => (reg ? reg.pushManager.getSubscription() : null))
          .then((sub) => (sub ? "on" : "off") as ThisPhone)
          .catch(() => "off" as ThisPhone)
      : Promise.resolve("unsupported" as ThisPhone);
    let cancelled = false;
    check.then((state) => {
      if (!cancelled) setThisPhone(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (count === 0 && (thisPhone === "unsupported" || !publicKey)) return null;

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/account/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; removed?: number };
  }

  async function switchOffHere() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      const endpoint = sub?.endpoint;
      if (sub) await sub.unsubscribe().catch(() => false);
      const result = await post(endpoint ? { businessId, endpoint } : { businessId });
      setThisPhone("off");
      if (result.ok) setCount((c) => Math.max(0, c - (result.removed ?? 1)));
      setNotice("Switched off on this phone.");
    } catch {
      setNotice("That didn't work right now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function switchOffEverywhere() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) await sub.unsubscribe().catch(() => false);
      const result = await post({ businessId });
      if (result.ok) {
        setCount(0);
        setThisPhone((p) => (p === "unsupported" ? p : "off"));
        setNotice(`Switched off everywhere at ${businessName}.`);
      } else {
        setNotice("That didn't work right now. Try again in a moment.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function switchOnHere() {
    if (busy || !publicKey) return;
    setBusy(true);
    setNotice(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setNotice("Your phone is blocking updates from this site. You can allow them in your browser's site settings.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) }));
      const res = await fetch("/api/account/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, subscription: sub.toJSON() }),
      });
      const result = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
      if (result.ok) {
        setThisPhone("on");
        setCount((c) => c + 1);
        setNotice("Done — we'll tell you on this phone when your order moves.");
      } else {
        setNotice("That didn't work right now. Try again in a moment.");
      }
    } catch {
      setNotice("That didn't work right now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const others = Math.max(0, count - (thisPhone === "on" ? 1 : 0));

  return (
    <section className={styles.card} aria-labelledby="push-settings">
      <p id="push-settings" className={styles.lede}>
        Order updates on this phone
      </p>
      {thisPhone === "checking" && <p className={styles.muted}>Checking this phone…</p>}
      {thisPhone === "on" && <p className={styles.muted}>On. We tell you here when an order at {businessName} is confirmed, ready or on its way.</p>}
      {thisPhone === "off" && publicKey && <p className={styles.muted}>Off on this phone.</p>}
      {thisPhone === "unsupported" && <p className={styles.muted}>This browser can&apos;t show order updates. On an iPhone, add {businessName} to your Home Screen first.</p>}
      {others > 0 && (
        <p className={styles.muted}>
          Also on {others === 1 ? "one other device" : `${others} other devices`}: {devices.map((d) => d.deviceLabel).join(", ")}.
        </p>
      )}
      <div className={styles.actions}>
        {thisPhone === "on" && (
          <button type="button" className="btn btnSecondary" onClick={switchOffHere} disabled={busy}>
            {busy ? "Working…" : "Switch off on this phone"}
          </button>
        )}
        {thisPhone === "off" && publicKey && (
          <button type="button" className="btn btnPrimary" onClick={switchOnHere} disabled={busy}>
            {busy ? "Working…" : "Switch on"}
          </button>
        )}
        {count > 0 && (
          <button type="button" className={styles.linkButton} onClick={switchOffEverywhere} disabled={busy}>
            Switch off everywhere at {businessName}
          </button>
        )}
      </div>
      {notice && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
