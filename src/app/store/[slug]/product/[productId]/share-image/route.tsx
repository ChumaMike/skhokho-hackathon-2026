// Explicit so the tree also compiles where JSX is transformed classically (the node test runner); Next itself uses the automatic runtime.
import * as React from "react";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { getBusinessBySlug } from "@/modules/tenant/tenant.service";
import { getActiveCatalog } from "@/modules/catalog/catalog.service";
import { buildStorefrontColorTokens } from "@/lib/storefront-colors";
import { checkRateLimits, clientIp } from "@/lib/rate-limit";
import { formatZAR } from "@/lib/utils";
import { SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH, hashtagLine } from "@/lib/storefront/share";

// A route file may only export Next's own names (the build's route type check
// enforces it), so the card's size lives in share.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREAM = "#FFF9EE";
const INK = "#171009";
const MUTED = "#6B6056";

/**
 * Social products (Tab 7): the picture a shared product link shows on
 * WhatsApp, Instagram, Facebook and friends — the product photo, its name,
 * the price as R 1 234.56, the shop's logo and name, and the hashtags, in
 * the shop's own colour. Composed on request with next/og (no new
 * dependency), cached for a day; the product page links to it with a
 * version token that changes when the name, price, photo or logo do.
 *
 * Public, like the product page itself: only active businesses, only
 * products in the live catalogue. The 404 is plain text so a scraper that
 * follows a dead link gets nothing to render.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string; productId: string }> }) {
  if (!(await checkRateLimits([["shareImageIp", clientIp(req)]])).allowed) {
    return new Response("Too many requests", { status: 429, headers: { "retry-after": "60" } });
  }
  const { slug, productId } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return new Response("Not found", { status: 404 });
  const catalog = await getActiveCatalog(business.id);
  const product = catalog.products.find((p) => p.id === productId);
  if (!product) return new Response("Not found", { status: 404 });

  const colors = buildStorefrontColorTokens(business);
  const primary = colors["--store-primary-safe"];
  const onPrimary = colors["--store-on-primary"];
  const photo = product.imageUrl ?? product.images[0] ?? null;
  const tags = hashtagLine(product.hashtags);
  const initial = (product.name.trim().charAt(0) || "·").toUpperCase();
  const shopInitial = (business.name.trim().charAt(0) || "·").toUpperCase();

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: CREAM, color: INK, fontFamily: "sans-serif" }}>
        {photo ? (
          // Business-supplied photo; satori fetches it while composing.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" width={560} height={630} style={{ width: 560, height: 630, objectFit: "cover" }} />
        ) : (
          <div style={{ width: 560, height: 630, display: "flex", alignItems: "center", justifyContent: "center", background: primary, color: onPrimary, fontSize: 260, fontWeight: 800 }}>
            {initial}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, padding: "52px 56px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {business.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={business.logoUrl} alt="" width={68} height={68} style={{ width: 68, height: 68, borderRadius: 999, objectFit: "cover" }} />
            ) : (
              <div style={{ width: 68, height: 68, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: primary, color: onPrimary, fontSize: 34, fontWeight: 800 }}>
                {shopInitial}
              </div>
            )}
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{business.name}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", fontSize: product.name.length > 40 ? 46 : 58, fontWeight: 800, lineHeight: 1.08, lineClamp: 3 }}>{product.name}</div>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 900, color: primary }}>{formatZAR(product.price)}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tags ? <div style={{ display: "flex", fontSize: 24, color: MUTED, lineClamp: 2 }}>{tags}</div> : null}
            <div style={{ display: "flex", height: 8, width: 120, borderRadius: 999, background: primary }} />
          </div>
        </div>
      </div>
    ),
    {
      width: SHARE_IMAGE_WIDTH,
      height: SHARE_IMAGE_HEIGHT,
      headers: {
        // A day at the edge and in the browser; the page's ?v= token changes when the card's inputs do.
        "cache-control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
