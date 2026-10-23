import { NextRequest } from "next/server";
import { z } from "zod";
import { assertCanActOnDelivery, recordDriverLocation } from "@/modules/orders/order-delivery.service";
import { ok, fail, handleApiError } from "@/lib/utils";

export const runtime = "nodejs";

const LocationSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

/**
 * A frequent (~every 10s), fire-and-forget background write from the
 * driver's own dashboard page while a delivery is PICKED_UP — a plain JSON
 * route rather than a server action, since this isn't a form submission.
 * Authorization is identical to every other driver-facing write
 * (markPickedUpAction etc.) via the shared assertCanActOnDelivery.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ deliveryId: string }> }) {
  try {
    const { deliveryId } = await params;
    const { tenantId } = await assertCanActOnDelivery(deliveryId);

    const body = await req.json().catch(() => null);
    const parsed = LocationSchema.safeParse(body);
    if (!parsed.success) return fail("Invalid location.");

    try {
      await recordDriverLocation(tenantId, deliveryId, parsed.data.lat, parsed.data.lng);
    } catch (e) {
      if (e instanceof Error && e.message === "DELIVERY_NOT_ACTIVE") {
        // Not an error — the delivery just isn't PICKED_UP anymore (delivered,
        // failed, or reassigned). Tells the client to stop polling.
        return ok({ active: false });
      }
      throw e;
    }

    return ok({ active: true });
  } catch (error) {
    return handleApiError(error);
  }
}
