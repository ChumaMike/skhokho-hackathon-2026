"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/utils";

interface Offer {
  id: string;
  expiresAt: string;
  toPickupMeters: number;
  tripMeters: number;
  earningCents: number;
  shopName: string;
  shopArea: string | null;
}

interface ActiveDelivery {
  id: string;
  status: string;
  earningCents: number;
  tripMeters: number;
  orderNumber: string;
  pickup: { name: string; address: string; phone: string | null };
  dropoff: { address: string; instructions: string | null; contactPhone: string | null };
  pickupCodeLocked: boolean;
  dropoffCodeLocked: boolean;
}

const rands = formatCents;
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

async function api(url: string, body?: unknown) {
  const res = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!json?.ok) throw new Error(json?.error ?? "Something went wrong.");
  return json;
}

/**
 * The approved driver's working screen. The server decides everything:
 * going online is a request; each delivery step is a named action; codes are
 * checked server-side. Location is only sent while online, at the interval
 * the server asks for, and only after the driver allowed it.
 */
export default function DriverConsole({ initialAvailability }: { initialAvailability: string }) {
  const router = useRouter();
  const [availability, setAvailability] = useState(initialAvailability);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [active, setActive] = useState<ActiveDelivery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const locationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [o, d] = await Promise.all([api("/api/driver/offers"), api("/api/driver/delivery")]);
      setOffers(o.offers);
      setActive(d.delivery);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Poll offers and the active delivery while online or busy.
  useEffect(() => {
    if (availability === "OFFLINE") return;
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [availability, refresh]);

  // Share location while online, at the server's requested interval.
  useEffect(() => {
    if (availability === "OFFLINE" || !("geolocation" in navigator)) return;
    let stopped = false;
    const send = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const r = await api("/api/driver/location", { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy });
            if (!stopped && r.nextInSeconds) locationTimer.current = setTimeout(send, r.nextInSeconds * 1000);
          } catch {
            if (!stopped) locationTimer.current = setTimeout(send, 60_000);
          }
        },
        () => {
          if (!stopped) locationTimer.current = setTimeout(send, 60_000);
        },
        { enableHighAccuracy: Boolean(active), maximumAge: 30_000, timeout: 20_000 },
      );
    };
    send();
    return () => {
      stopped = true;
      if (locationTimer.current) clearTimeout(locationTimer.current);
    };
  }, [availability, active]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setCode("");
      setReason("");
      await refresh();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (online: boolean) => act(async () => setAvailability((await api("/api/driver/availability", { online })).availability));
  const step = (action: string, extra: Record<string, string> = {}) => act(() => api(`/api/driver/delivery/${active!.id}`, { action, ...extra }));

  return (
    <section aria-label="Driving">
      {error && <p className="errorBanner" role="alert">{error}</p>}

      {!active && (
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span>
            You&apos;re <strong>{availability === "ONLINE" ? "online" : availability === "BUSY" ? "on a delivery" : "offline"}</strong>
          </span>
          {availability === "ONLINE" ? (
            <button type="button" className="btn" disabled={busy} onClick={() => toggle(false)} style={{ minHeight: 44 }}>Go offline</button>
          ) : (
            <button type="button" className="btn btnPrimary" disabled={busy} onClick={() => toggle(true)} style={{ minHeight: 44 }}>Go online</button>
          )}
        </div>
      )}

      {!active && availability === "ONLINE" && (
        <div style={{ marginTop: 16 }}>
          <h2>Offers</h2>
          {offers.length === 0 && <p>Waiting for a delivery near you…</p>}
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
            {offers.map((o) => (
              <li key={o.id} className="card">
                <strong>{o.shopName}</strong>
                {o.shopArea && <span> · {o.shopArea}</span>}
                <p style={{ margin: "6px 0" }}>
                  {km(o.toPickupMeters)} to the shop · {km(o.tripMeters)} trip · you earn <strong>{rands(o.earningCents)}</strong>
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn btnPrimary" style={{ minHeight: 44 }} disabled={busy} onClick={() => act(() => api(`/api/driver/offers/${o.id}`, { decision: "ACCEPT" }))}>Accept</button>
                  <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => act(() => api(`/api/driver/offers/${o.id}`, { decision: "DECLINE" }))}>No thanks</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {active && (
        <div className="card" style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <strong>Order {active.orderNumber} · you earn {rands(active.earningCents)}</strong>
          <div>
            <span className="eyebrow">Pick up</span>
            <p style={{ margin: 0 }}>{active.pickup.name}<br />{active.pickup.address}</p>
            {active.pickup.phone && <a href={`tel:${active.pickup.phone}`}>Call the shop</a>}
          </div>
          <div>
            <span className="eyebrow">Drop off</span>
            <p style={{ margin: 0 }}>{active.dropoff.address}</p>
            {active.dropoff.instructions && <p style={{ margin: 0 }}>Note: {active.dropoff.instructions}</p>}
            {active.dropoff.contactPhone && <a href={`tel:${active.dropoff.contactPhone}`}>Call the customer</a>}
          </div>

          {active.status === "ASSIGNED" && <button type="button" className="btn btnPrimary" style={{ minHeight: 44 }} disabled={busy} onClick={() => step("HEAD_TO_PICKUP")}>I&apos;m on my way to the shop</button>}
          {(active.status === "ASSIGNED" || active.status === "DRIVER_TO_PICKUP") && <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => step("ARRIVE_PICKUP")}>I&apos;m at the shop</button>}

          {(active.status === "ARRIVED_PICKUP" || active.status === "RETURNING") && (
            <form onSubmit={(e) => { e.preventDefault(); step(active.status === "RETURNING" ? "CONFIRM_RETURN" : "CONFIRM_PICKUP", { code }); }}>
              <label className="label" htmlFor="pickupCode">{active.status === "RETURNING" ? "Returned — enter the shop's code" : "Ask the shop for the pickup code"}</label>
              <input className="input" id="pickupCode" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required />
              <button type="submit" className="btn btnPrimary" style={{ minHeight: 44, marginTop: 8 }} disabled={busy || active.pickupCodeLocked}>Confirm</button>
              {active.pickupCodeLocked && <p className="errorBanner">Too many wrong codes — ask the shop for a new one.</p>}
            </form>
          )}

          {active.status === "PICKED_UP" && <button type="button" className="btn btnPrimary" style={{ minHeight: 44 }} disabled={busy} onClick={() => step("START_TRANSIT")}>Start the trip</button>}
          {(active.status === "PICKED_UP" || active.status === "IN_TRANSIT") && <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => step("ARRIVE_DROPOFF")}>I&apos;ve arrived</button>}

          {active.status === "ARRIVED_DROPOFF" && (
            <form onSubmit={(e) => { e.preventDefault(); step("CONFIRM_DELIVERY", { code }); }}>
              <label className="label" htmlFor="dropoffCode">Ask the customer for their delivery code</label>
              <input className="input" id="dropoffCode" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required />
              <button type="submit" className="btn btnPrimary" style={{ minHeight: 44, marginTop: 8 }} disabled={busy || active.dropoffCodeLocked}>Complete delivery</button>
              {active.dropoffCodeLocked && <p className="errorBanner">Too many wrong codes — the customer can get a new code from the shop.</p>}
            </form>
          )}

          {["PICKED_UP", "IN_TRANSIT", "ARRIVED_DROPOFF"].includes(active.status) && (
            <details>
              <summary>I can&apos;t complete this delivery</summary>
              <form onSubmit={(e) => { e.preventDefault(); step("FAIL", { reason }); }}>
                <label className="label" htmlFor="reason">What happened?</label>
                <input className="input" id="reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={2} maxLength={300} required />
                <button type="submit" className="btn" style={{ minHeight: 44, marginTop: 8 }} disabled={busy}>Report and take it back to the shop</button>
              </form>
            </details>
          )}
          {active.status === "FAILED" && <button type="button" className="btn btnPrimary" style={{ minHeight: 44 }} disabled={busy} onClick={() => step("START_RETURN")}>I&apos;m taking it back to the shop</button>}
        </div>
      )}
    </section>
  );
}
