"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js (Web Push only — it caches nothing) on storefront and
 * account pages, once per browser, and only when the deployment has Web
 * Push configured: the server renders this component with `enabled` only
 * then, so an unconfigured deployment never installs a worker at all.
 *
 * Registration alone asks the customer nothing. The permission question is
 * PushPrompt's, and it is only ever asked after an order or a sign-in.
 */
export default function PushServiceWorker({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // A browser that refuses (private mode, storage off) simply has no push; nothing else changes.
    });
  }, [enabled]);
  return null;
}
