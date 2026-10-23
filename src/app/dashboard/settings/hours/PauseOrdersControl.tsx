import type { TradingStatus } from "@/modules/tenant/trading-status";
import { pauseOrdersAction } from "./actions";

/**
 * "Pause orders now" — shown on the hours page and the orders queue. Server
 * component: the form posts to pauseOrdersAction (canManageOrders). The state
 * it displays comes from getTradingStatus, the same source checkout enforces.
 */
export default function PauseOrdersControl({ trading, returnTo }: { trading: TradingStatus; returnTo: string }) {
  const paused = trading.state === "PAUSED";
  return (
    <form action={pauseOrdersAction.bind(null, returnTo)} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontWeight: 600 }}>
        {paused ? trading.label : trading.state === "CLOSED" ? "Closed by your hours" : "Taking orders"}
      </span>
      {paused ? (
        <>
          <input type="hidden" name="duration" value="resume" />
          <button type="submit" className="btn btnPrimary" style={{ minHeight: 44 }}>Resume orders</button>
        </>
      ) : (
        <>
          <select className="input" name="duration" defaultValue="30" style={{ maxWidth: 190, minHeight: 44 }} aria-label="Pause for">
            <option value="30">Pause for 30 min</option>
            <option value="60">Pause for 1 hour</option>
            <option value="120">Pause for 2 hours</option>
            <option value="240">Pause for 4 hours</option>
            <option value="rest">Pause for the rest of today</option>
          </select>
          <button type="submit" className="btn" style={{ minHeight: 44 }}>Pause orders</button>
        </>
      )}
    </form>
  );
}
