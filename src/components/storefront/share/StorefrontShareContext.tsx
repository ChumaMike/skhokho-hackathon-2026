"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface StorefrontShareInfo {
  businessId: string;
  businessName: string;
  /** The storefront's canonical root, no trailing slash (storefront-url.ts) — product links in shares start here. */
  origin: string;
}

const StorefrontShareContext = createContext<StorefrontShareInfo | null>(null);

/**
 * What every share button on a live storefront needs and no product card
 * carries: which shop this is, its name for the message, and the canonical
 * address shares should point at. The store layout provides it once; the
 * merchant's preview renders outside that layout, so there a ShareButton
 * renders nothing rather than sharing a preview address.
 */
export function StorefrontShareProvider({ value, children }: { value: StorefrontShareInfo; children: ReactNode }) {
  return <StorefrontShareContext.Provider value={value}>{children}</StorefrontShareContext.Provider>;
}

export function useStorefrontShare(): StorefrontShareInfo | null {
  return useContext(StorefrontShareContext);
}
