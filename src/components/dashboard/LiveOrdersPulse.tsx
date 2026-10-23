"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

interface Pulse {
  pendingOrders: number;
  activeOrders: number;
  newestOrderId: string | null;
  newestOrderAt: string | null;
  unreadNotifications: number;
}

const POLL_MS = 12_000;
const MUTE_KEY = "skhokho-orders-mute";

/** A short two-tone chime, generated — no audio asset needed. Only after the person has interacted with the page (browser rule). */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const play = (freq: number, at: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.4);
    };
    play(880, 0);
    play(1175, 0.18);
  } catch {
    // audio unavailable — the visual signal still shows
  }
}

/**
 * Polls /api/dashboard/pulse while the tab is visible and shows a sticky
 * strip when there are new (unconfirmed) orders or unread notifications. On
 * a change it refreshes the current server-rendered page, so the orders /
 * kitchen / home lists update without anyone pressing reload. Sound is
 * opt-in per browser (muted by default until the person unmutes), because a
 * browser won't play audio before an interaction anyway.
 */
export default function LiveOrdersPulse({ ordersHref }: { ordersHref: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [muted, setMuted] = useState(true);
  const [flash, setFlash] = useState(false);
  const lastNewest = useRef<string | null>(null);
  const lastPending = useRef<number | null>(null);

  useEffect(() => {
    try {
      setMuted(window.localStorage.getItem(MUTE_KEY) !== "off");
    } catch {
      setMuted(true);
    }
  }, []);

  const poll = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/dashboard/pulse", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as Pulse & { ok: boolean };
      if (!next.ok) return;
      const firstRun = lastNewest.current === null && lastPending.current === null;
      const newOrder = !firstRun && next.newestOrderId !== lastNewest.current && next.pendingOrders > (lastPending.current ?? 0);
      const changed = !firstRun && (next.newestOrderId !== lastNewest.current || next.pendingOrders !== lastPending.current);
      lastNewest.current = next.newestOrderId;
      lastPending.current = next.pendingOrders;
      setPulse(next);
      if (newOrder) {
        setFlash(true);
        setTimeout(() => setFlash(false), 4000);
        if (!muted) chime();
      }
      if (changed) router.refresh();
    } catch {
      // offline for a moment — try again next tick
    }
  }, [muted, router]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    try {
      window.localStorage.setItem(MUTE_KEY, next ? "on" : "off");
    } catch {
      // storage unavailable
    }
    if (!next) chime();
  }

  if (!pulse) return null;
  const attention = pulse.pendingOrders > 0 || pulse.unreadNotifications > 0;
  if (!attention && !flash) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
        padding: "8px 12px",
        background: flash ? "var(--amber, #e8a020)" : "var(--board, #171009)",
        color: flash ? "var(--ink, #0e0a05)" : "var(--chalk, #f5efe6)",
        borderBottom: "1px solid var(--edge, #2e2011)",
        fontSize: "0.92rem",
        transition: "background 300ms",
      }}
    >
      {pulse.pendingOrders > 0 && (
        <Link href={ordersHref} style={{ fontWeight: 700, color: "inherit" }}>
          {pulse.pendingOrders} new order{pulse.pendingOrders === 1 ? "" : "s"} waiting
        </Link>
      )}
      {pulse.unreadNotifications > 0 && pathname !== "/dashboard/notifications" && (
        <Link href="/dashboard/notifications" style={{ color: "inherit" }}>
          {pulse.unreadNotifications} notification{pulse.unreadNotifications === 1 ? "" : "s"}
        </Link>
      )}
      <button type="button" onClick={toggleMute} className="btn" style={{ marginLeft: "auto", minHeight: 36, padding: "4px 10px" }} aria-pressed={!muted}>
        {muted ? "🔕 Sound off" : "🔔 Sound on"}
      </button>
    </div>
  );
}
