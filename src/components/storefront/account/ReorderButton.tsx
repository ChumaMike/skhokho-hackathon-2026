"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loadCart, saveCart, withLineDelta } from "@/lib/storefront/cart";

/**
 * "Order again": puts the order's lines (product ids, quantities, chosen
 * option ids) into this business's basket and opens it. The basket's own
 * server quote re-prices everything and tells the customer about anything
 * that has since gone — nothing stale is ever charged.
 */
export default function ReorderButton({
  businessId,
  basePath,
  lines,
  className,
}: {
  businessId: string;
  basePath: string;
  lines: { productId: string; quantity: number; optionIds?: string[] }[];
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (lines.length === 0) return null;
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        let cart = loadCart(businessId);
        for (const line of lines) cart = withLineDelta(cart, line.productId, line.quantity, line.optionIds);
        saveCart(cart);
        router.push(`${basePath}/basket`);
      }}
    >
      {busy ? "Opening your basket…" : "Order again"}
    </button>
  );
}
