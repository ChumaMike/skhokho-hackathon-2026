"use client";

import { useEffect, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";

const POLL_MS = 5000;

interface TrackingResponse {
  deliveryStatus: "UNASSIGNED" | "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "FAILED";
  driverLat: number | null;
  driverLng: number | null;
  driverLocationUpdatedAt: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  failureReason: string | null;
}

/**
 * Loads the Google Maps JS SDK only on this page (never bundled elsewhere)
 * and polls /api/orders/[orderId]/tracking every POLL_MS while the delivery
 * is PICKED_UP, updating the driver marker's position on each tick. Stops
 * polling immediately once the server reports DELIVERED/FAILED, so a tab
 * left open after delivery doesn't poll forever.
 */
export default function OrderTrackingMap({ orderId }: { orderId: string }) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const destinationMarkerRef = useRef<google.maps.Marker | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setError("Live tracking isn't configured for this shop yet.");
      return;
    }

    let cancelled = false;
    let pollHandle: ReturnType<typeof setTimeout> | undefined;

    const loader = new Loader({ apiKey, version: "weekly" });

    async function poll() {
      try {
        const res = await fetch(`/api/orders/${orderId}/tracking`, { cache: "no-store" });
        const body = (await res.json()) as { ok: boolean; data?: TrackingResponse };
        if (cancelled || !body.ok || !body.data) return;
        const data = body.data;

        if (!mapRef.current && mapDivRef.current) {
          await loader.importLibrary("maps");
          await loader.importLibrary("marker");
          const center =
            data.driverLat && data.driverLng
              ? { lat: data.driverLat, lng: data.driverLng }
              : data.destinationLat && data.destinationLng
                ? { lat: data.destinationLat, lng: data.destinationLng }
                : { lat: -26.2041, lng: 28.0473 }; // Johannesburg — generic fallback center
          mapRef.current = new google.maps.Map(mapDivRef.current, {
            center,
            zoom: 13,
            disableDefaultUI: true,
            zoomControl: true,
          });
        }

        if (data.destinationLat && data.destinationLng && mapRef.current && !destinationMarkerRef.current) {
          destinationMarkerRef.current = new google.maps.Marker({
            position: { lat: data.destinationLat, lng: data.destinationLng },
            map: mapRef.current,
            label: "You",
          });
        }

        if (data.driverLat && data.driverLng && mapRef.current) {
          const position = { lat: data.driverLat, lng: data.driverLng };
          if (!driverMarkerRef.current) {
            driverMarkerRef.current = new google.maps.Marker({
              position,
              map: mapRef.current,
              label: "Driver",
            });
          } else {
            driverMarkerRef.current.setPosition(position);
          }
          mapRef.current.panTo(position);
        }

        if (data.deliveryStatus === "PICKED_UP" && !cancelled) {
          pollHandle = setTimeout(poll, POLL_MS);
        }
      } catch {
        if (!cancelled) pollHandle = setTimeout(poll, POLL_MS);
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (pollHandle) clearTimeout(pollHandle);
    };
  }, [orderId]);

  if (error) return <p className="sub">{error}</p>;
  return <div ref={mapDivRef} style={{ width: "100%", height: 360, borderRadius: 12 }} />;
}
