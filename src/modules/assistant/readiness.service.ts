import { prisma } from "@/lib/prisma/client";
import { getDeliverySettings } from "@/modules/tenant/capabilities";
import { computeReadiness, type ReadinessItem } from "./readiness";

const NOTIFY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function hasHours(operatingHours: unknown): boolean {
  return !!operatingHours && typeof operatingHours === "object" && Object.keys(operatingHours as object).length > 0;
}

export async function getBusinessReadiness(businessId: string): Promise<ReadinessItem[]> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      status: true,
      logoUrl: true,
      bannerUrl: true,
      phone: true,
      whatsapp: true,
      address: true,
      suburb: true,
      city: true,
      operatingHours: true,
      settings: true,
    },
  });
  if (!business) return [];

  const products = await prisma.product.findMany({
    where: { businessId, isActive: true },
    select: { imageUrl: true, images: true },
  });
  const delivery = getDeliverySettings(business);

  return computeReadiness({
    status: business.status,
    logoUrl: business.logoUrl,
    bannerUrl: business.bannerUrl,
    phone: business.phone,
    whatsapp: business.whatsapp,
    address: business.address,
    suburb: business.suburb,
    city: business.city,
    hasOperatingHours: hasHours(business.operatingHours),
    activeProductCount: products.length,
    productsWithPhoto: products.filter((p) => p.imageUrl || p.images.length > 0).length,
    deliveryEnabled: delivery.enabled,
    deliveryAreaInfo: delivery.areaInfo ?? null,
  });
}

/**
 * Tells the owner about warnings through the existing notifications list, at
 * most once per gap per week, so the buddy never spams. Suggestions stay on
 * the dock only.
 */
export async function notifyReadinessWarnings(businessId: string, items: ReadinessItem[]): Promise<void> {
  const since = new Date(Date.now() - NOTIFY_COOLDOWN_MS);
  for (const item of items.filter((i) => i.severity === "WARNING")) {
    const type = `buddy:${item.key}`;
    const recent = await prisma.businessNotification.findFirst({
      where: { businessId, type, createdAt: { gte: since } },
      select: { id: true },
    });
    if (recent) continue;
    await prisma.businessNotification.create({
      data: {
        businessId,
        type,
        title: item.title,
        message: item.message,
        data: { href: item.href },
      },
    });
  }
}
