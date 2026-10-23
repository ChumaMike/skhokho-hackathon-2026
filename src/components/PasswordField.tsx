"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import styles from "./PasswordField.module.css";

/**
 * A password `<input>` with a show/hide toggle — every password field in
 * the app (join, login, staff-login, set-password, reset-password) was
 * plain `type="password"` with no way to check what you typed before
 * submitting. One shared component instead of five copies of the same
 * eye-icon button.
 */
export default function PasswordField({
  id,
  name,
  label,
  placeholder,
  required,
  minLength,
  autoComplete,
}: {
  id: string;
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  const toggleId = useId();

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className={styles.wrap}>
        <input
          className={`input ${styles.input}`}
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={visible}
          aria-controls={toggleId}
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      <span id={toggleId} className="sr-only" aria-live="polite">
        {visible ? "Password is visible" : "Password is hidden"}
      </span>
    </div>
  );
}
