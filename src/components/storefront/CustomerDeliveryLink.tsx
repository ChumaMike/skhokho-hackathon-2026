"use client";

import { useEffect, useState } from "react";
import { recallDeliveryUrl } from "./customer-delivery-link";

/** Shows the customer's own delivery-page link, if THIS browser placed the order. */
export default function CustomerDeliveryLink({ orderId }: { orderId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => setUrl(recallDeliveryUrl(orderId)), [orderId]);
  if (!url) return null;
  return (
    <p>
      <a className="btn btnPrimary" href={url}>Your delivery page</a>
      <br />
      <small>If a Skhokholetha driver brings your order, your delivery code appears there. Keep it to yourself until your order is in your hands.</small>
    </p>
  );
}
