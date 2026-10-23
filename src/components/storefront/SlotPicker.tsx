"use client";

import { useEffect, useState } from "react";
import styles from "./SlotPicker.module.css";

interface Slot {
  time: string;
  available: boolean;
}

function todayISODate(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Replaces the raw <input type="datetime-local"> the booking form used to
 * expose directly — DESIGN.md: "Only show times that can actually be
 * booked." Writes the chosen slot into a hidden <input name={name}> so the
 * surrounding <form>'s existing submit (POST /api/store/book) is
 * completely unchanged; this component only changes how startTime gets
 * chosen, not how the booking is created.
 */
export default function SlotPicker({ businessId, serviceId, name }: { businessId: string; serviceId: string; name: string }) {
  const [date, setDate] = useState(todayISODate());
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Bare disable (no rule name): local eslint-plugin-react-hooks
    // doesn't define this rule, Vercel's fresh install does and flags
    // this line — see dashboard/page.tsx's identical note.
    // eslint-disable-next-line
    setLoading(true);
    setError(false);
    setSelected(null);
    const params = new URLSearchParams({ businessId, serviceId, date });
    fetch(`/api/store/availability?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((data: { slots: Slot[] }) => {
        if (!cancelled) setSlots(data.slots);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, serviceId, date]);

  const anyAvailable = slots?.some((s) => s.available) ?? false;

  return (
    <div className={styles.picker}>
      <input
        className={`input ${styles.dateInput}`}
        type="date"
        value={date}
        min={todayISODate()}
        onChange={(e) => setDate(e.target.value)}
        aria-label="Choose a date"
      />

      {loading && <p className={styles.hint}>Checking availability…</p>}
      {!loading && error && <p className={styles.hint}>Couldn&apos;t load times — try another date.</p>}
      {!loading && !error && slots && !anyAvailable && (
        <p className={styles.hint}>No open times that day — try another date.</p>
      )}
      {!loading && !error && slots && anyAvailable && (
        <div className={styles.slotGrid}>
          {slots
            .filter((s) => s.available)
            .map((s) => (
              <button
                key={s.time}
                type="button"
                className={`${styles.slot} ${selected === s.time ? styles.slotSelected : ""}`}
                onClick={() => setSelected(s.time)}
              >
                {formatTime(s.time)}
              </button>
            ))}
        </div>
      )}

      {/* Not HTML5 `required` — hidden inputs are barred from constraint
         validation by spec, so that attribute would be a silent no-op.
         An empty submission already gets a clear server-side error
         ("Choose a valid date and time.") from /api/store/book. */}
      <input type="hidden" name={name} value={selected ?? ""} />
    </div>
  );
}
