"use client";

import { useState } from "react";
import styles from "./discover.module.css";

/**
 * The only client-side JS on this page. Fills the (hidden, server-rendered)
 * lat/lng/radiusKm fields and submits the surrounding GET form — the actual
 * search still happens server-side on the resulting page load, not here.
 */
export default function LocateButton() {
  const [status, setStatus] = useState<"idle" | "locating" | "done" | "error">("idle");

  function handleClick() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const form = document.getElementById("discover-filters") as HTMLFormElement | null;
        if (form) {
          (form.elements.namedItem("lat") as HTMLInputElement).value = String(position.coords.latitude);
          (form.elements.namedItem("lng") as HTMLInputElement).value = String(position.coords.longitude);
          (form.elements.namedItem("radiusKm") as HTMLInputElement).value = "15";
          form.requestSubmit();
        }
        setStatus("done");
      },
      () => setStatus("error"),
      { timeout: 8000 },
    );
  }

  return (
    <button
      type="button"
      className={styles.locateBtn}
      data-active={status === "done"}
      onClick={handleClick}
    >
      {status === "locating" ? "Finding you…" : status === "done" ? "Near me ✓" : "Near me"}
    </button>
  );
}
