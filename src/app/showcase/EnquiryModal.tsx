"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { submitEnquiry } from "./actions";
import styles from "./EnquiryModal.module.css";

interface EnquiryModalProps {
  /** Plan name (STARTER…) or service slug — written to `PlatformEnquiry.interest`. */
  interest: string;
  /** Human-readable label for the heading, e.g. "the Professional plan". */
  label: string;
  onClose: () => void;
}

/**
 * The short form the task asks for, opened by picking anything in the
 * showcase. Built as a full-screen overlay reusing the app's own
 * shell/column/bottomBar primitives (globals.css) rather than a floating
 * dialog card — it then looks and behaves like every other screen in this
 * app instead of introducing a new modal pattern DESIGN.md never specified.
 */
export default function EnquiryModal({ interest, label, onClose }: EnquiryModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;
    setError(null);

    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const businessName = String(form.get("businessName") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();

    if (!name) return setError("Enter your name.");
    if (!phone) return setError("Enter your phone number.");

    startTransition(async () => {
      const result = await submitEnquiry({
        interest,
        name,
        phone,
        email: email || undefined,
        businessName: businessName || undefined,
        message: message || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSubmitted(true);
    });
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="enquiry-title">
      <div className={styles.overlayInner}>
        <div className="column">
          <button type="button" className={styles.close} onClick={onClose}>
            ← Back
          </button>
          <span className="eyebrow">Tell us where to reach you</span>
          <h1 id="enquiry-title" className={styles.title}>
            {label}
          </h1>

          {submitted ? (
            <div className="successBanner">
              Thanks — we&apos;ve got it. Someone from Skhokho will contact
              you about {label.toLowerCase()} soon.
            </div>
          ) : (
            <>
              <p className={styles.sub}>
                Leave your number and we&apos;ll get in touch. Nothing is
                billed from this form.
              </p>
              <form id="enquiry-form" onSubmit={handleSubmit}>
                {error && <div className="errorBanner">{error}</div>}

                <div className="field">
                  <label className="label" htmlFor="name">
                    Your name
                  </label>
                  <input
                    ref={firstFieldRef}
                    className="input"
                    id="name"
                    name="name"
                    autoComplete="name"
                    required
                  />
                </div>

                <div className="field">
                  <label className="label" htmlFor="phone">
                    WhatsApp number
                  </label>
                  <input
                    className="input"
                    id="phone"
                    name="phone"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="082 123 4567"
                    required
                  />
                </div>

                <div className="field">
                  <label className="label" htmlFor="email">
                    Email (optional)
                  </label>
                  <input
                    className="input"
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                  />
                </div>

                <div className="field">
                  <label className="label" htmlFor="businessName">
                    Business name (optional)
                  </label>
                  <input
                    className="input"
                    id="businessName"
                    name="businessName"
                    autoComplete="organization"
                  />
                </div>

                <div className="field">
                  <label className="label" htmlFor="message">
                    Anything else? (optional)
                  </label>
                  <textarea
                    className={`input ${styles.textarea}`}
                    id="message"
                    name="message"
                    rows={3}
                  />
                </div>
              </form>
            </>
          )}
        </div>

        <div className="bottomBar">
          <div className="bottomBarInner">
            {submitted ? (
              <button type="button" className="btn btnPrimary btnBlock" onClick={onClose}>
                Done
              </button>
            ) : (
              <button
                type="submit"
                form="enquiry-form"
                className="btn btnPrimary btnBlock"
                disabled={isPending}
              >
                {isPending ? "Sending…" : "Send enquiry"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
