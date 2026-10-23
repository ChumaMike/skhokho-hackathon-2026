import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";
import { SERVER_ACTION_BODY_LIMIT } from "./src/lib/upload-limits";

// ---- Tab 5 ----
// CSP, HSTS and Permissions-Policy are built in src/lib/security-headers.ts
// (unit-tested). The preview path repeats the full policy with
// frame-ancestors 'self' because Next replaces a duplicate header key with
// the later rule's value — a bare "frame-ancestors 'self'" there would have
// dropped every other directive for that path.
const isDev = process.env.NODE_ENV !== "production";
const tab5Headers = securityHeaders({ dev: isDev });
const tab5PreviewHeaders = securityHeaders({ dev: isDev, frameAncestors: "self" });
// ---- end Tab 5 ----

const nextConfig: NextConfig = {
  // ---- Tab 5 ----
  // Server Action forms carry images (business logo, item photos). Next's
  // default body limit is 1 MB — smaller than a phone photo — and a form
  // over it fails with a bare 413 error page after the whole upload has
  // crawled in (the 2026-10-21 settings incident). Raised to just under
  // Vercel's 4.5 MB cap; the forms refuse bigger files before sending
  // (src/lib/upload-limits.ts, unit-tested against this value).
  experimental: { serverActions: { bodySizeLimit: SERVER_ACTION_BODY_LIMIT } },
  // ---- end Tab 5 ----
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // ---- Tab 5 ----
          ...tab5Headers,
          // ---- end Tab 5 ----
        ],
      },
      {
        // The dashboard frames storefront previews at phone and desktop
        // widths. Same-origin only — every other page stays DENY. Listed
        // after the catch-all so it overrides X-Frame-Options for this path.
        source: "/preview/storefront/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // ---- Tab 5 ----
          ...tab5PreviewHeaders,
          // ---- end Tab 5 ----
        ],
      },
      // ---- Tab 7 (storefront websites): noindex for personal storefront paths ----
      // A basket, checkout, account or configurator is personal, never a
      // page to index — on the platform path and on a merchant's own host
      // (where the path has no /store/<slug> prefix). Header-level so it
      // holds for Tab 3's checkout and account pages without editing them;
      // the per-storefront robots.txt disallows the same paths.
      {
        source: "/store/:slug/:page(basket|checkout|account|configure)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/store/:slug/:page(basket|checkout|account|configure)/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/:page(basket|checkout|account|configure)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/:page(basket|checkout|account|configure)/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
