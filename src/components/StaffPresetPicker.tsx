"use client";

import { useId, useState } from "react";
import styles from "./StaffPresetPicker.module.css";

export interface StaffPresetOption {
  id: string;
  label: string;
  jobTitle: string;
  grants: string[];
  denies: string[];
  note?: string;
}

/**
 * "What does this person do?" — replaces the old technical StaffRole
 * dropdown. Picking a preset updates the suggested job title (still freely
 * editable) and shows a plain-language grants/denies summary, so an owner
 * never has to reason about permission flags directly.
 */
export default function StaffPresetPicker({
  options,
  defaultId,
  defaultJobTitle,
}: {
  options: StaffPresetOption[];
  /** Pre-selects an existing member's current preset when editing, rather than always defaulting to the first option (invite-time behaviour). */
  defaultId?: string;
  defaultJobTitle?: string;
}) {
  const initial = options.find((o) => o.id === defaultId) ?? options[0];
  const [selectedId, setSelectedId] = useState(initial?.id ?? "");
  const [jobTitle, setJobTitle] = useState(defaultJobTitle ?? initial?.jobTitle ?? "");
  const jobTitleId = useId();

  const selected = options.find((o) => o.id === selectedId) ?? options[0];

  return (
    <>
      <div className="field">
        <label className="label" htmlFor="preset">
          What does this person do?
        </label>
        <select
          className="input"
          id="preset"
          name="preset"
          value={selectedId}
          onChange={(e) => {
            const next = options.find((o) => o.id === e.target.value);
            setSelectedId(e.target.value);
            if (next) setJobTitle(next.jobTitle);
          }}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor={jobTitleId}>
          Job title
        </label>
        <input
          className="input"
          id={jobTitleId}
          name="jobTitle"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          maxLength={100}
        />
      </div>

      {selected && (
        <div className={styles.summary}>
          <p className={styles.summaryTitle}>{selected.label} access</p>
          {selected.grants.length > 0 && (
            <ul className={styles.grantList}>
              {selected.grants.map((grant) => (
                <li key={grant}>{grant}</li>
              ))}
            </ul>
          )}
          {selected.denies.length > 0 && (
            <ul className={styles.denyList}>
              {selected.denies.map((deny) => (
                <li key={deny}>{deny}</li>
              ))}
            </ul>
          )}
          {selected.note && <p className={styles.note}>{selected.note}</p>}
        </div>
      )}
    </>
  );
}
