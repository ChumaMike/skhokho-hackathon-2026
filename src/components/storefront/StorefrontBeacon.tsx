"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type Page = "HOME" | "SHOP" | "ABOUT" | "CONTACT" | "GALLERY" | "PRODUCT" | "BASKET" | "CHECKOUT" | "CONFIGURE" | "TAG" | `page:${string}`;

/** An owner page's address (page model slug) — anything else is not counted at all. */
const OWNER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type ClientEvent = { type: string; page: Page; section?: string; itemId?: string };

const FLUSH_MS = 1500;

/** Which storefront page a path is, and the catalogue item in it if any. */
export function classifyStorefrontPath(pathname: string, basePath: string): { page: Page; itemId?: string } | null {
  const rest = (basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname).replace(/\/+$/, "");
  const [first, second] = rest.split("/").filter(Boolean);
  switch (first) {
    case undefined:
      return { page: "HOME" };
    case "shop":
      return { page: "SHOP" };
    case "about":
      return { page: "ABOUT" };
    case "contact":
      return { page: "CONTACT" };
    case "gallery":
      return { page: "GALLERY" };
    case "basket":
      return { page: "BASKET" };
    case "checkout":
      return { page: "CHECKOUT" };
    case "product":
      return second ? { page: "PRODUCT", itemId: second } : null;
    case "configure":
      return second ? { page: "CONFIGURE", itemId: second } : null;
    case "tag":
      // Hashtag pages (Tab 7): counted together; the tag itself is the merchant's word, never sent.
      return second ? { page: "TAG" } : null;
    default:
      // Services, reviews, policies, request forms, custom pages: counted by their own address.
      return !second && first.length <= 40 && OWNER_SLUG.test(first) ? { page: `page:${first}` } : null;
  }
}

/**
 * Privacy-aware storefront analytics. Sends ONLY counters' inputs: an event
 * type, the page, an optional section and catalogue item id, and whether the
 * screen is phone- or computer-sized. No cookies, no storage, no identifier
 * of any kind; nothing is sent at all when the browser asks not to be
 * tracked (Do Not Track / Global Privacy Control).
 */
export default function StorefrontBeacon({ businessId, basePath }: { businessId: string; basePath: string }) {
  const pathname = usePathname();

  useEffect(() => {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl === true) return;

    const where = classifyStorefrontPath(pathname, basePath);
    if (!where) return;
    const device = window.innerWidth < 768 ? "MOBILE" : "DESKTOP";
    let queue: ClientEvent[] = [{ type: "PAGE_VIEW", page: where.page }];
    if (where.page === "PRODUCT" && where.itemId) queue.push({ type: "PRODUCT_VIEW", page: "PRODUCT", itemId: where.itemId });
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      while (queue.length > 0) {
        const batch = queue.slice(0, 10);
        queue = queue.slice(10);
        const body = JSON.stringify({ businessId, device, events: batch });
        if (!navigator.sendBeacon?.("/api/store/events", new Blob([body], { type: "application/json" }))) {
          void fetch("/api/store/events", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
        }
      }
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    };

    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>("[data-sf-event]");
      if (!el) return;
      const section = el.dataset.sfSection ?? el.closest<HTMLElement>("[data-sf-section]")?.dataset.sfSection;
      queue.push({ type: el.dataset.sfEvent!, page: where.page, ...(section ? { section } : {}), ...(el.dataset.sfItem ? { itemId: el.dataset.sfItem } : {}) });
      schedule();
    };
    const onHide = () => flush();

    document.addEventListener("click", onClick, true);
    window.addEventListener("pagehide", onHide);
    schedule();
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, [pathname, basePath, businessId]);

  return null;
}
