import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { checkRateLimits, clientIp } from "@/lib/rate-limit";
import { apiRequestTenant, orderVisibleOnRequest } from "@/lib/tenant/storefront-request";

export const runtime = "nodejs";

/** A driver position older than this is not "live" and is not returned. */
const FRESH_POSITION_MS = 2 * 60 * 1000;

const NOT_FOUND = NextResponse.json({ ok: false, error: "Not found" }, { status: 404, headers: { "cache-control": "no-store" } });

/**
 * Polling endpoint for the customer's in-house delivery map (/store/order/[id]).
 * The order id is the only key — an unguessable cuid, the same trust model as
 * /store/pay/[orderId] — so everything else here is defence in depth:
 *
 *  - rate limited per IP (the shared tracking rule), 429 when exceeded;
 *  - on a tenant host, only that tenant's orders exist (404 otherwise);
 *  - unknown, non-delivery and cross-tenant ids all look the same (404);
 *  - the payload is the minimum a map needs: status, the destination pin, and
 *    the driver's position ONLY while the order is actually out (PICKED_UP)
 *    and the position is fresh. Never the driver's identity, never the
 *    customer's address text or phone, never the failure reason text (the
 *    page renders that from the server, not from this poll).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const limited = await checkRateLimits([["trackingIp", clientIp(req)]]);
  if (!limited.allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds), "cache-control": "no-store" } });
  }
  const { orderId } = await params;
  if (!/^[a-z0-9]{20,40}$/i.test(orderId)) return NOT_FOUND;

  const delivery = await prisma.orderDelivery.findUnique({
    where: { orderId },
    select: { businessId: true, status: true, driverLat: true, driverLng: true, driverLocationUpdatedAt: true, deliveryLat: true, deliveryLng: true },
  });
  if (!delivery) return NOT_FOUND;
  const tenant = await apiRequestTenant(req);
  if (!orderVisibleOnRequest(delivery.businessId, tenant)) return NOT_FOUND;

  const live =
    delivery.status === "PICKED_UP" &&
    delivery.driverLocationUpdatedAt !== null &&
    Date.now() - delivery.driverLocationUpdatedAt.getTime() < FRESH_POSITION_MS &&
    delivery.driverLat !== null &&
    delivery.driverLng !== null;

  return NextResponse.json(
    {
      ok: true,
      data: {
        deliveryStatus: delivery.status,
        driverLat: live ? delivery.driverLat : null,
        driverLng: live ? delivery.driverLng : null,
        driverLocationUpdatedAt: live ? delivery.driverLocationUpdatedAt!.toISOString() : null,
        destinationLat: delivery.deliveryLat,
        destinationLng: delivery.deliveryLng,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
