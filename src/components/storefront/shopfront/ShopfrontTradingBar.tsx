import type { Business } from "@prisma/client";
import { getTradingStatus } from "@/modules/tenant/trading-status";
import { getDeliverySettings, getFulfilmentSettings } from "@/modules/tenant/capabilities";
import { publicZoneTable } from "@/modules/delivery/delivery-quote";
import { listActiveZones } from "@/modules/delivery/zones.service";
import { formatCents } from "@/lib/utils";
import shared from "./Shopfront.module.css";

/**
 * OPEN / CLOSED / ORDERS PAUSED, plus how the customer can get their order —
 * rendered from the business's structured configuration, never from an
 * uploaded poster. Same functions checkout enforces (trading-status.ts,
 * delivery-quote.ts), so the storefront can't promise something the quote
 * refuses.
 */
export default async function ShopfrontTradingBar({ business }: { business: Pick<Business, "id" | "settings" | "operatingHours"> }) {
  const trading = getTradingStatus(business);
  const fulfilment = getFulfilmentSettings(business);
  const delivery = getDeliverySettings(business);
  const zones = delivery.enabled && delivery.pricingMode === "ZONE" ? publicZoneTable(delivery, await listActiveZones(business.id)) : [];
  const tone = trading.state === "OPEN" ? "var(--veld, #3a7d44)" : "var(--oxide, #b4472f)";

  return (
    <section className={shared.container} aria-label="Opening status and delivery" style={{ display: "grid", gap: 10, paddingTop: 12, paddingBottom: 4 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${tone}`, color: tone, borderRadius: 999, padding: "3px 10px", fontWeight: 600, fontSize: "0.85rem" }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: tone }} />
          {trading.state === "OPEN" ? "OPEN" : trading.state === "PAUSED" ? "ORDERS PAUSED" : "CLOSED"}
        </span>
        <span style={{ fontSize: "0.9rem", opacity: 0.85 }}>{trading.label}</span>
      </div>

      <div style={{ fontSize: "0.9rem", display: "grid", gap: 4 }}>
        {fulfilment.collectionEnabled && <span>Collection available.</span>}
        {!delivery.enabled && <span>Collection only — no delivery.</span>}
        {delivery.enabled && delivery.pricingMode === "FLAT" && <span>Delivery {formatCents(delivery.feeCents)} flat.</span>}
        {delivery.enabled && delivery.pricingMode === "PER_KM" && (
          <span>
            Delivery by distance from {formatCents(Math.max(delivery.minFeeCents, delivery.baseFeeCents))}
            {delivery.maxDistanceKm > 0 ? `, up to ${delivery.maxDistanceKm} km away` : ""} — exact fee at checkout.
          </span>
        )}
        {delivery.enabled && delivery.pricingMode === "ZONE" && zones.length > 0 && (
          <details>
            <summary style={{ cursor: "pointer" }}>Delivery areas and fees</summary>
            <table style={{ borderCollapse: "collapse", marginTop: 6 }}>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id}>
                    <td style={{ padding: "3px 16px 3px 0" }}>{z.name}</td>
                    <td style={{ padding: "3px 0", textAlign: "right" }}>{formatCents(z.feeCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
        {delivery.enabled && delivery.areaInfo && <span style={{ opacity: 0.85 }}>{delivery.areaInfo}</span>}
      </div>
    </section>
  );
}
