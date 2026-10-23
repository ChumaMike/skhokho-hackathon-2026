"use client";

import { useEffect, useRef } from "react";

/**
 * Submits its child <form> the instant it mounts — no dangerouslySetInnerHTML,
 * no inline script. Shared by every PayFast handoff (customer checkout and
 * the owner's account-verification flow): PayFast requires an actual HTML
 * form POST carrying the signed fields, not a plain redirect link with the
 * fields in the query string — a GET submission gets a 400 from PayFast's
 * own engine.
 */
export default function AutoSubmitForm({
  action,
  fields,
}: {
  action: string;
  fields: [string, string][];
}) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.submit();
  }, []);

  return (
    <form ref={formRef} method="post" action={action}>
      {fields.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <noscript>
        <button type="submit" className="btn btnPrimary">
          Continue to payment
        </button>
      </noscript>
    </form>
  );
}
