"use client";

import { useEffect, useRef, useState } from "react";
import { buildShareMessage, productSharePath } from "@/lib/storefront/share";
import { useStorefrontShare } from "./StorefrontShareContext";
import styles from "./ShareButton.module.css";

type Outcome = "idle" | "copied" | "failed";

/**
 * "Share" for one product: the Web Share API on phones (WhatsApp, Instagram,
 * TikTok, Facebook, SMS — whatever the phone offers), copy-to-clipboard
 * where there is no share sheet (most desktop browsers). The message is
 * share.ts's: name, price, shop, hashtags, link.
 *
 * `icon` is the small round button for cards and menu rows; `button` the
 * labelled one for the product page. Closing the share sheet without
 * choosing anything is not an error and says nothing.
 *
 * A completed share (or copy) is counted once, server side, with nothing
 * about the customer: POST /api/store/share carries the shop and product
 * ids and no more. Counting never blocks or fails the share.
 */
export default function ShareButton({
  product,
  url,
  variant = "icon",
  className,
}: {
  product: { id: string; name: string; price: string | number; hashtags?: readonly string[] };
  /** The canonical product URL when the caller knows it (the product page); cards derive it from the storefront root. */
  url?: string;
  variant?: "icon" | "button";
  className?: string;
}) {
  const share = useStorefrontShare();
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // No storefront context (the merchant's preview, a stray embed): nothing to share to.
  if (!share) return null;

  function settle(next: Outcome) {
    setOutcome(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOutcome("idle"), 2200);
  }

  function counted() {
    if (!share) return;
    const body = JSON.stringify({ businessId: share.businessId, productId: product.id });
    void fetch("/api/store/share", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
  }

  async function onShare() {
    if (!share) return;
    const message = buildShareMessage({
      name: product.name,
      price: product.price,
      businessName: share.businessName,
      hashtags: product.hashtags,
      url: url ?? `${share.origin}${productSharePath(product.id)}`,
    });
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
    const data: ShareData = { title: message.title, text: message.text, url: message.url };
    if (typeof nav.share === "function" && (!nav.canShare || nav.canShare(data))) {
      try {
        await nav.share(data);
        counted();
        return;
      } catch (e) {
        // The customer closed the sheet: not a failure, nothing to say.
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Anything else (a desktop browser that lists share() but can't): fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(message.full);
      counted();
      settle("copied");
    } catch {
      settle("failed");
    }
  }

  const label = `Share ${product.name}`;
  const status = outcome === "copied" ? "Link copied" : outcome === "failed" ? "Couldn't copy — long-press the address bar to share" : "";

  if (variant === "button") {
    return (
      <span className={styles.wrap}>
        <button type="button" className={className ?? styles.button} onClick={onShare} aria-label={label}>
          <ShareGlyph />
          <span>{outcome === "copied" ? "Link copied" : "Share"}</span>
        </button>
        <span className={styles.status} role="status" aria-live="polite">
          {outcome === "failed" ? status : ""}
        </span>
      </span>
    );
  }

  return (
    <span className={styles.wrap}>
      <button type="button" className={`${styles.icon} ${className ?? ""}`} onClick={onShare} aria-label={label} title="Share">
        <ShareGlyph />
      </button>
      <span className={styles.status} role="status" aria-live="polite">
        {status}
      </span>
    </span>
  );
}

/** The share glyph (a box with an arrow up out of it) — inline, so it takes the shop's text colour. */
function ShareGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}
