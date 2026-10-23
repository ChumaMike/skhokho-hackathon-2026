"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./AssistantDock.module.css";
import BuddyChat from "./BuddyChat";
import BuddyToday, { type Briefing } from "./BuddyToday";

const POSITION_KEY = "skhokho.buddy.position";

function loadPosition(): { x: number; y: number } | null {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    return raw ? (JSON.parse(raw) as { x: number; y: number }) : null;
  } catch {
    return null;
  }
}

function savePosition(pos: { x: number; y: number }) {
  try {
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
  } catch {
    // Private windows can block storage; the dock just won't remember its spot.
  }
}

/**
 * The Business Buddy: a floating dock on every dashboard screen. "Today"
 * answers what's happening, what needs attention and what to do next —
 * limited on the server to what the signed-in person's role may see — with
 * Preview → Apply for the few changes it may prepare. Draggable, and it
 * remembers where it was left in this browser.
 */
export default function AssistantDock() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"today" | "chat">("today");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  useEffect(() => {
    setPos(loadPosition());
    let cancelled = false;
    // A failed load must never read as "all clear".
    fetch("/api/dashboard/buddy/briefing", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.ok) setBriefing(body.data.briefing as Briefing);
        else setLoadFailed(true);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const warnings = briefing?.attention.length ?? 0;

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!drag.current) return;
    drag.current.moved = true;
    setPos({
      x: Math.max(8, Math.min(window.innerWidth - 64, e.clientX - drag.current.dx)),
      y: Math.max(8, Math.min(window.innerHeight - 64, e.clientY - drag.current.dy)),
    });
  }

  function onPointerUp() {
    const wasDrag = drag.current?.moved;
    drag.current = null;
    if (wasDrag && pos) savePosition(pos);
    else if (!wasDrag) setOpen((v) => !v);
  }

  const style = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;

  return (
    <div className={styles.root} style={style}>
      {open && (
        <div className={styles.panel} role="dialog" aria-label="Ask Skhokho">
          <div className={styles.panelHead}>
            <strong>Ask Skhokho</strong>
            <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "today"}
              className={tab === "today" ? styles.tabActive : styles.tab}
              onClick={() => setTab("today")}
            >
              Today
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "chat"}
              className={tab === "chat" ? styles.tabActive : styles.tab}
              onClick={() => setTab("chat")}
            >
              Chat
            </button>
          </div>
          {tab === "chat" && <BuddyChat />}
          {tab === "today" &&
            (loadFailed ? (
              <p className={styles.error} role="alert">
                Couldn&apos;t load today&apos;s briefing. Try again in a moment.
              </p>
            ) : (
              <BuddyToday briefing={briefing} />
            ))}
        </div>
      )}
      <button
        type="button"
        className={styles.bubble}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label={warnings > 0 ? `Ask Skhokho, ${warnings} things need attention` : "Ask Skhokho"}
      >
        <span aria-hidden="true">✦</span>
        {warnings > 0 && <span className={styles.badge}>{warnings}</span>}
      </button>
    </div>
  );
}
