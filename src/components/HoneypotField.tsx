import { HONEYPOT_FIELD } from "@/lib/honeypot";

/**
 * An input real people never see or reach (off-screen, hidden from screen
 * readers, skipped by Tab, no autofill). Form-filling bots tend to fill every
 * field; the server rejects any submission where this one has a value.
 */
export default function HoneypotField() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
      <label>
        Leave this empty
        <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}
