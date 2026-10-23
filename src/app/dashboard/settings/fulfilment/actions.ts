"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { setDeliverySettings, setFulfilmentSettings, type DeliverySource, type DeliveryPricingMode } from "@/modules/tenant/capabilities";
import { createZone, deleteZone, DeliveryZoneError, moveZone, setZoneActive, updateZone } from "@/modules/delivery/zones.service";
import { trimmedOrUndefined } from "@/lib/utils";

const PAGE = "/dashboard/settings/fulfilment";

async function permitted(): Promise<string> {
  try {
    const { payload } = await requireStaffPermission("canManageSettings");
    return payload.tenantId;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    redirect(`${PAGE}?err=${encodeURIComponent(err instanceof Error ? err.message : "Not allowed.")}`);
  }
}

function done(): never {
  for (const p of [PAGE, "/dashboard", "/dashboard/settings", "/dashboard/storefront/ordering", "/dashboard/deliveries"]) revalidatePath(p);
  redirect(`${PAGE}?saved=1`);
}

function failed(e: unknown): never {
  const message = e instanceof DeliveryZoneError ? e.message : e instanceof ZodError ? e.issues[0]?.message ?? "Check the details." : e instanceof Error ? e.message : "Could not save.";
  redirect(`${PAGE}?err=${encodeURIComponent(message)}`);
}

/** Rand text ("25" / "25.50") → integer cents, or null when blank/invalid. */
function cents(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** One form: collection, delivery on/off, pricing mode + fields, who delivers. */
export async function updateFulfilmentAction(fd: FormData): Promise<void> {
  const tenantId = await permitted();
  const mode = String(fd.get("pricingMode") ?? "FLAT");
  const pricingMode: DeliveryPricingMode = mode === "PER_KM" || mode === "ZONE" ? mode : "FLAT";
  const sourcesRaw = String(fd.get("deliverySources") ?? "BOTH");
  const deliverySources: DeliverySource = sourcesRaw === "OWN" || sourcesRaw === "NETWORK" ? sourcesRaw : "BOTH";
  const maxKm = Number(String(fd.get("maxDistanceKm") ?? "0").replace(",", "."));
  try {
    await setDeliverySettings(tenantId, {
      enabled: fd.get("deliveryEnabled") === "on",
      pricingMode,
      feeCents: cents(fd.get("flatFee")) ?? 0,
      perKmFeeCents: cents(fd.get("perKmFee")) ?? 0,
      baseFeeCents: cents(fd.get("baseFee")) ?? 0,
      minFeeCents: cents(fd.get("minFee")) ?? 0,
      maxDistanceKm: Number.isFinite(maxKm) && maxKm >= 0 ? Math.round(maxKm * 10) / 10 : 0,
      areaInfo: trimmedOrUndefined(fd.get("areaInfo")),
    });
    await setFulfilmentSettings(tenantId, { collectionEnabled: fd.get("collectionEnabled") === "on", deliverySources });
  } catch (e) {
    failed(e);
  }
  done();
}

function zoneInput(fd: FormData) {
  const fee = cents(fd.get("fee"));
  const minRaw = String(fd.get("minOrder") ?? "").trim();
  const min = minRaw ? cents(minRaw) : null;
  return {
    name: String(fd.get("name") ?? "").trim(),
    matchKind: fd.get("matchKind") === "SUBURB_LIST" ? "SUBURB_LIST" : "CUSTOMER_PICK",
    suburbs: String(fd.get("suburbs") ?? "")
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean),
    feeCents: fee ?? -1, // -1 fails validation with a clear message
    minOrderCents: min,
    active: fd.get("active") !== "off",
  };
}

export async function addZoneAction(fd: FormData): Promise<void> {
  const tenantId = await permitted();
  try {
    await createZone(tenantId, zoneInput(fd));
  } catch (e) {
    failed(e);
  }
  done();
}

export async function saveZoneAction(zoneId: string, fd: FormData): Promise<void> {
  const tenantId = await permitted();
  try {
    await updateZone(tenantId, zoneId, { ...zoneInput(fd), priority: Number(fd.get("priority") ?? 0) || 0 });
  } catch (e) {
    failed(e);
  }
  done();
}

export async function toggleZoneAction(zoneId: string, active: boolean): Promise<void> {
  const tenantId = await permitted();
  try {
    await setZoneActive(tenantId, zoneId, active);
  } catch (e) {
    failed(e);
  }
  done();
}

export async function moveZoneAction(zoneId: string, direction: "UP" | "DOWN"): Promise<void> {
  const tenantId = await permitted();
  try {
    await moveZone(tenantId, zoneId, direction === "UP" ? "UP" : "DOWN");
  } catch (e) {
    failed(e);
  }
  done();
}

export async function deleteZoneAction(zoneId: string): Promise<void> {
  const tenantId = await permitted();
  try {
    await deleteZone(tenantId, zoneId);
  } catch (e) {
    failed(e);
  }
  done();
}
