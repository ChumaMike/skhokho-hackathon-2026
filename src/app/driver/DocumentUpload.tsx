"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Uploads one document to the driver's private document store. */
export default function DocumentUpload({ kinds }: { kinds: { value: string; label: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/driver/documents", { method: "POST", body: new FormData(e.currentTarget) });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error ?? "Upload failed.");
      setMessage({ ok: true, text: "Uploaded — our team will check it." });
      e.currentTarget.reset();
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label className="label" htmlFor="kind">Document</label>
        <select className="input" id="kind" name="kind" required>
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="file">File (PDF or photo, up to 5 MB)</label>
        <input className="input" id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required />
      </div>
      <div className="field">
        <label className="label" htmlFor="expiresOn">Expiry date (if it has one)</label>
        <input className="input" id="expiresOn" name="expiresOn" type="date" />
      </div>
      {message && <p className={message.ok ? "successBanner" : "errorBanner"} role="status">{message.text}</p>}
      <button type="submit" className="btn btnBlock" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
    </form>
  );
}
