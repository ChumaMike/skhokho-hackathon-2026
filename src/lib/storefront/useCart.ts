"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadCart,
  saveCart,
  clearCart as clearStoredCart,
  withLineDelta,
  withLineQuantity,
  cartLineCount,
  lineKeyOf,
  quantityOfLine as quantityOfLineImpl,
  removeLineByKey as removeLineByKeyImpl,
  CART_CHANGE_EVENT,
  type CartState,
} from "./cart";

/**
 * The one place any storefront component reads/writes the basket. Always
 * businessId-scoped (see cart.ts) — a page for Business A never sees
 * Business B's lines, even reusing the same browser tab/origin.
 */
export function useCart(businessId: string) {
  // Server-rendered markup always starts from an empty cart (localStorage
  // doesn't exist on the server) — the real value is read once on mount,
  // after hydration, matching the "fail gracefully into an empty in-memory
  // cart" requirement rather than trying to read storage during SSR.
  const [cart, setCart] = useState<CartState>(() => ({
    version: 1,
    businessId,
    lines: [],
    updatedAt: new Date().toISOString(),
  }));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // localStorage doesn't exist during SSR/first render — this is a
    // legitimate one-time sync from an external system on mount, not state
    // derived from props/other state, so the setState-in-effect rule's
    // usual concern (cascading renders from avoidable state sync) doesn't
    // apply here.
    // Bare disable (no rule name): local eslint-plugin-react-hooks
    // doesn't define this rule, Vercel's fresh install does and flags
    // this line — see dashboard/page.tsx's identical note.
    // eslint-disable-next-line
    setCart(loadCart(businessId));
    setHydrated(true);
    // businessId shouldn't change under a mounted storefront page, but if
    // it ever does (e.g. a client-side route transition this app doesn't
    // currently do), re-read the correct business's own basket rather than
    // silently keep showing the previous one.
  }, [businessId]);

  useEffect(() => {
    // Keeps every useCart instance for this business in sync within the
    // same tab (see CART_CHANGE_EVENT's doc comment) — e.g. a nav basket
    // badge and a product grid are two independent mounts that must agree
    // the instant either one changes the cart.
    function onCartChange(e: Event) {
      const detail = (e as CustomEvent<{ businessId: string }>).detail;
      if (detail?.businessId === businessId) setCart(loadCart(businessId));
    }
    window.addEventListener(CART_CHANGE_EVENT, onCartChange);
    return () => window.removeEventListener(CART_CHANGE_EVENT, onCartChange);
  }, [businessId]);

  const persist = useCallback((next: CartState) => {
    setCart(next);
    saveCart(next);
  }, []);

  const setQuantity = useCallback(
    (productId: string, quantity: number) => {
      persist(withLineQuantity(cart, productId, quantity));
    },
    [cart, persist],
  );

  const addQuantity = useCallback(
    (productId: string, delta = 1) => {
      persist(withLineDelta(cart, productId, delta));
    },
    [cart, persist],
  );

  const removeLine = useCallback(
    (productId: string) => {
      persist(withLineQuantity(cart, productId, 0));
    },
    [cart, persist],
  );

  /** Food Menu Domain Foundation §10/§11 — adds (or increases) a specific product+options configuration as its own cart line, never merging into a differently-configured line of the same product. */
  const addConfiguredLine = useCallback(
    (productId: string, optionIds: string[], quantity: number) => {
      persist(withLineDelta(cart, productId, quantity, optionIds));
    },
    [cart, persist],
  );

  const removeLineByKey = useCallback(
    (lineKey: string) => {
      persist(removeLineByKeyImpl(cart, lineKey));
    },
    [cart, persist],
  );

  const clear = useCallback(() => {
    clearStoredCart(businessId);
    setCart({ version: 1, businessId, lines: [], updatedAt: new Date().toISOString() });
  }, [businessId]);

  return {
    /** True once the real (localStorage-backed) cart has been read — before this, `cart` is deliberately empty to avoid an SSR/client mismatch. */
    hydrated,
    cart,
    lines: cart.lines,
    totalCount: cartLineCount(cart),
    quantityOf: (productId: string) => cart.lines.find((l) => l.productId === productId)?.quantity ?? 0,
    /** Quantity of one specific configuration — 0 if that exact productId+optionIds combination isn't in the cart. */
    quantityOfLine: (productId: string, optionIds?: string[]) => quantityOfLineImpl(cart, productId, optionIds),
    lineKeyOf,
    setQuantity,
    addQuantity,
    addConfiguredLine,
    removeLine,
    removeLineByKey,
    clear,
  };
}
