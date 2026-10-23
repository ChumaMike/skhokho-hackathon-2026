"use client";

import type React from "react";
import { Dialog } from "@base-ui/react/dialog";
import styles from "./Modal.module.css";

/**
 * Accessible modal on Base UI's headless Dialog primitives — focus trap,
 * ESC-to-close, backdrop dismiss and ARIA wiring come from the library;
 * only visual styling lives here. Replaces the raw <details>/<summary>
 * disclosure the catalogue "add" forms used before (flagged as the least
 * finished element in the dashboard UI — see docs/DESIGN.md's history).
 */
export function Modal({
  trigger,
  triggerClassName,
  title,
  children,
}: {
  trigger: React.ReactNode;
  triggerClassName?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className={triggerClassName}>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.popup}>
          <Dialog.Title className={styles.title}>{title}</Dialog.Title>
          <Dialog.Close className={styles.close} aria-label="Close">
            ✕
          </Dialog.Close>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
