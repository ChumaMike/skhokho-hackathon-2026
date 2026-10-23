"use client";

import { useEffect, useRef, useState } from "react";

const THROTTLE_MS = 10_000;

/**
 * Shares the driver's live position for every currently PICKED_UP delivery
 * on this page, auto-starting the moment there's at least one (no separate
 * toggle — nothing to forget). One `watchPosition` for the whole page, not
 * one per delivery, so a driver with several active drops doesn't run N
 * redundant GPS watchers. Throttled to at most once per delivery per
 * THROTTLE_MS, balancing a "live" feel against battery/data usage.
 *
 * Silently stops posting once the server reports a delivery is no longer
 * active (DELIVERED/FAILED/reassigned) — matches recordDriverLocation's own
 * `DELIVERY_NOT_ACTIVE` signal, so a stale client never keeps hammering a
 * finished delivery.
 */
export default function DriverLocationSharer({ activeDeliveryIds }: { activeDeliveryIds: string[] }) {
  const [unavailable, setUnavailable] = useState(false);
  const lastSentRef = useRef<Record<string, number>>({});
  const stoppedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (activeDeliveryIds.length === 0) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setUnavailable(true);
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        const { latitude, longitude } = position.coords;
        for (const deliveryId of activeDeliveryIds) {
          if (stoppedRef.current.has(deliveryId)) continue;
          const last = lastSentRef.current[deliveryId] ?? 0;
          if (now - last < THROTTLE_MS) continue;
          lastSentRef.current[deliveryId] = now;

          fetch(`/api/driver/deliveries/${deliveryId}/location`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: latitude, lng: longitude }),
          })
            .then((res) => res.json())
            .then((body) => {
              if (body?.data?.active === false) stoppedRef.current.add(deliveryId);
            })
            .catch(() => {
              // A dropped ping just gets caught by the next tick — never
              // surfaced to the driver, who can't act on it anyway.
            });
        }
      },
      () => setUnavailable(true),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeDeliveryIds]);

  if (activeDeliveryIds.length === 0) return null;
  if (unavailable) {
    return <p className="sub">Location sharing isn&apos;t available on this device.</p>;
  }
  return <p className="sub">Sharing your live location for delivery tracking.</p>;
}
