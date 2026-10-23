"use client";

import { useState } from "react";

/** Copies the draft text so the person can paste it into WhatsApp, Instagram or Facebook themselves. */
export default function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }
  return (
    <button type="button" className="btn" onClick={copy} aria-live="polite">
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy the text" : "Copy text"}
    </button>
  );
}
