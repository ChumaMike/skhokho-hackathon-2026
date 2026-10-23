"use client";

import { useState } from "react";

/**
 * Copies an absolute URL built from a relative `path` to the clipboard —
 * used for the review-request link shown once an order/appointment is
 * marked complete. This app has no SMS/WhatsApp send capability, so
 * "share this link" is a copy button the owner pastes into a WhatsApp
 * chat themselves, not an automated send.
 */
export default function CopyLinkButton({
  path,
  className,
  label = "Copy review link",
  copiedLabel = "Copied",
}: {
  path: string;
  className?: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (insecure context, denied
      // permission) — the button just stays a no-op rather than throwing.
    }
  }

  return (
    <button type="button" className={className} onClick={handleClick}>
      {copied ? copiedLabel : label}
    </button>
  );
}
