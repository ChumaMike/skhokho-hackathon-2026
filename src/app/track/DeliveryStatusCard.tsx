const STATUS_COPY: Record<string, string> = {
  CREATED: "We're getting your delivery ready.",
  SEARCHING: "We're finding a driver near the shop.",
  OFFERED: "We're finding a driver near the shop.",
  ASSIGNED: "A driver is on the way to collect your order.",
  DRIVER_TO_PICKUP: "Your driver is on the way to the shop.",
  ARRIVED_PICKUP: "Your driver is collecting your order.",
  PICKED_UP: "Your order has been collected.",
  IN_TRANSIT: "Your order is on its way to you.",
  ARRIVED_DROPOFF: "Your driver has arrived.",
  DELIVERED: "Delivered. Enjoy!",
  CANCELLED: "This delivery was cancelled. The shop will be in touch.",
  FAILED: "We couldn't complete this delivery. The shop will be in touch.",
  RETURNING: "Your order is going back to the shop. The shop will be in touch.",
  RETURNED: "Your order is back at the shop. The shop will be in touch.",
  DISPUTED: "Our team is looking into this delivery.",
};

const VEHICLE: Record<string, string> = { BICYCLE: "bicycle", SCOOTER: "scooter", MOTORCYCLE: "motorbike", CAR: "car", BAKKIE: "bakkie" };

/** Statuses where the page refreshes itself (no script needed). */
export const REFRESHING_STATUSES = ["CREATED", "SEARCHING", "OFFERED", "ASSIGNED", "DRIVER_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "IN_TRANSIT", "ARRIVED_DROPOFF"];

export interface DeliveryStatusView {
  status: string;
  driver: { firstName: string; vehicle: string | null } | null;
  driverPosition: { lat: number; lng: number } | null;
  etaMinutes: number | null;
}

/** Status, driver and ETA — shared by the shop's status link and the customer's own page. Carries no secret. */
export default function DeliveryStatusCard({ view }: { view: DeliveryStatusView }) {
  return (
    <div className="card" style={{ display: "grid", gap: 8 }}>
      <p style={{ fontSize: "1.15rem", margin: 0 }}>{STATUS_COPY[view.status] ?? "Checking your delivery…"}</p>
      {view.driver && (
        <p style={{ margin: 0 }}>
          Your driver: <strong>{view.driver.firstName}</strong>
          {view.driver.vehicle ? ` on a ${VEHICLE[view.driver.vehicle] ?? "vehicle"}` : ""}
        </p>
      )}
      {view.etaMinutes != null && <p style={{ margin: 0 }}>About {view.etaMinutes} min away.</p>}
      {view.driverPosition && (
        <p style={{ margin: 0 }}>
          <a
            href={`https://www.openstreetmap.org/?mlat=${view.driverPosition.lat.toFixed(4)}&mlon=${view.driverPosition.lng.toFixed(4)}#map=15/${view.driverPosition.lat.toFixed(4)}/${view.driverPosition.lng.toFixed(4)}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            See roughly where your driver is
          </a>
        </p>
      )}
    </div>
  );
}
