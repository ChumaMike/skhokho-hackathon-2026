import test from "node:test";
import assert from "node:assert/strict";
import {
  CART_SCHEMA_VERSION,
  MAX_LINE_QUANTITY,
  MAX_CART_LINES,
  CART_EXPIRY_MS,
  withLineQuantity,
  withLineDelta,
  cartLineCount,
  loadCart,
  saveCart,
  clearCart,
  lineKeyOf,
  quantityOfLine,
  linesForProduct,
  removeLineByKey,
  type CartState,
} from "./cart";

function emptyCart(businessId: string): CartState {
  return { version: CART_SCHEMA_VERSION, businessId, lines: [], updatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Pure reducer logic — no window/localStorage involved.
// ---------------------------------------------------------------------------

test("withLineDelta adds a new line at quantity 1", () => {
  const next = withLineDelta(emptyCart("b1"), "p1", 1);
  assert.deepEqual(next.lines, [{ productId: "p1", quantity: 1 }]);
});

test("withLineDelta increments an existing line", () => {
  let cart = withLineDelta(emptyCart("b1"), "p1", 1);
  cart = withLineDelta(cart, "p1", 1);
  assert.deepEqual(cart.lines, [{ productId: "p1", quantity: 2 }]);
});

test("withLineDelta at quantity 1, decreasing by 1, removes the line (quantity zero -> gone)", () => {
  let cart = withLineDelta(emptyCart("b1"), "p1", 1);
  cart = withLineDelta(cart, "p1", -1);
  assert.deepEqual(cart.lines, []);
});

test("withLineQuantity never exceeds MAX_LINE_QUANTITY", () => {
  const cart = withLineQuantity(emptyCart("b1"), "p1", MAX_LINE_QUANTITY + 50);
  assert.equal(cart.lines[0]!.quantity, MAX_LINE_QUANTITY);
});

test("withLineQuantity never goes negative — clamps to removal at zero or below", () => {
  const cart = withLineQuantity(emptyCart("b1"), "p1", -5);
  assert.deepEqual(cart.lines, []);
});

test("withLineQuantity(0) removes an existing line explicitly (the Remove action)", () => {
  let cart = withLineQuantity(emptyCart("b1"), "p1", 3);
  cart = withLineQuantity(cart, "p1", 0);
  assert.deepEqual(cart.lines, []);
});

test("a cart at MAX_CART_LINES silently refuses a genuinely new line, but still allows updating an existing one", () => {
  let cart = emptyCart("b1");
  for (let i = 0; i < MAX_CART_LINES; i++) cart = withLineQuantity(cart, `p${i}`, 1);
  assert.equal(cart.lines.length, MAX_CART_LINES);

  const withNewLine = withLineQuantity(cart, "p-new", 1);
  assert.equal(withNewLine.lines.length, MAX_CART_LINES, "must not exceed the line-count ceiling");

  const withUpdatedExisting = withLineQuantity(cart, "p0", 5);
  assert.equal(withUpdatedExisting.lines.length, MAX_CART_LINES);
  assert.equal(withUpdatedExisting.lines.find((l) => l.productId === "p0")?.quantity, 5);
});

// ---------------------------------------------------------------------------
// Food Menu Domain Foundation §11 — cart-line identity with selected options
// ---------------------------------------------------------------------------

test("lineKeyOf: a line with no optionIds keys identically to its bare productId (backward compatibility with every pre-Phase-4 cart entry)", () => {
  assert.equal(lineKeyOf({ productId: "p1", optionIds: undefined }), "p1");
  assert.equal(lineKeyOf({ productId: "p1", optionIds: [] }), "p1");
});

test("withLineQuantity/withLineDelta with no optionIds argument keep addressing exactly the simple, unconfigured line — identical to pre-Phase-4 behaviour", () => {
  let cart = withLineQuantity(emptyCart("b1"), "p1", 2);
  cart = withLineDelta(cart, "p1", 1);
  assert.deepEqual(cart.lines, [{ productId: "p1", quantity: 3 }]);
});

test("two differently-configured lines of the same product remain distinct entries in the client cart", () => {
  let cart = withLineQuantity(emptyCart("b1"), "kota", 1, ["large", "cheese"]);
  cart = withLineQuantity(cart, "kota", 1, ["regular"]);
  assert.equal(cart.lines.length, 2);
  assert.equal(quantityOfLine(cart, "kota", ["large", "cheese"]), 1);
  assert.equal(quantityOfLine(cart, "kota", ["regular"]), 1);
  assert.equal(linesForProduct(cart, "kota").length, 2);
});

test("two identically-configured lines (option order irrelevant) of the same product combine into one, quantity summed", () => {
  let cart = withLineQuantity(emptyCart("b1"), "kota", 1, ["cheese", "large"]);
  cart = withLineDelta(cart, "kota", 2, ["large", "cheese"]);
  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0].quantity, 3);
});

test("withLineQuantity(0, optionIds) removes only that specific configuration, leaving a differently-configured line of the same product untouched", () => {
  let cart = withLineQuantity(emptyCart("b1"), "kota", 1, ["large"]);
  cart = withLineQuantity(cart, "kota", 1, ["regular"]);
  cart = withLineQuantity(cart, "kota", 0, ["large"]);
  assert.equal(cart.lines.length, 1);
  assert.equal(quantityOfLine(cart, "kota", ["regular"]), 1);
  assert.equal(quantityOfLine(cart, "kota", ["large"]), 0);
});

test("removeLineByKey removes exactly the targeted configuration", () => {
  let cart = withLineQuantity(emptyCart("b1"), "kota", 1, ["large"]);
  cart = withLineQuantity(cart, "kota", 1, ["regular"]);
  const key = lineKeyOf({ productId: "kota", optionIds: ["large"] });
  cart = removeLineByKey(cart, key);
  assert.equal(cart.lines.length, 1);
  assert.equal(quantityOfLine(cart, "kota", ["regular"]), 1);
});

test("sanitize (via loadCart) preserves optionIds through a storage round-trip and normalizes their order", () => {
  withFakeWindow(() => {
    const cart = withLineQuantity(emptyCart("biz-a"), "kota", 1, ["cheese", "large"]);
    saveCart(cart);
    const loaded = loadCart("biz-a");
    assert.equal(loaded.lines.length, 1);
    assert.deepEqual(loaded.lines[0].optionIds, ["cheese", "large"]);
  });
});

test("sanitize drops a corrupt optionIds entry (not an array of non-empty strings) rather than crashing", () => {
  withFakeWindow((storage) => {
    storage.setItem(
      `skhokho:cart:v${CART_SCHEMA_VERSION}:biz-a`,
      JSON.stringify({
        version: CART_SCHEMA_VERSION,
        businessId: "biz-a",
        lines: [{ productId: "p1", quantity: 1, optionIds: [123, "", "ok-option"] }],
        updatedAt: new Date().toISOString(),
      }),
    );
    const loaded = loadCart("biz-a");
    assert.deepEqual(loaded.lines, [{ productId: "p1", quantity: 1, optionIds: ["ok-option"] }]);
  });
});

test("cartLineCount sums quantities across distinct lines, not line count", () => {
  let cart = withLineQuantity(emptyCart("b1"), "p1", 3);
  cart = withLineQuantity(cart, "p2", 2);
  assert.equal(cartLineCount(cart), 5);
});

test("withLineQuantity never mutates the input cart (pure)", () => {
  const original = withLineQuantity(emptyCart("b1"), "p1", 1);
  const originalLinesRef = original.lines;
  withLineQuantity(original, "p1", 2);
  assert.equal(original.lines, originalLinesRef, "the original cart object must be untouched");
});

// ---------------------------------------------------------------------------
// Storage integration — a minimal in-memory localStorage shim, no jsdom.
// ---------------------------------------------------------------------------

class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

function withFakeWindow<T>(fn: (storage: FakeStorage) => T): T {
  const storage = new FakeStorage();
  const realWindow = (globalThis as unknown as { window?: unknown }).window;
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
  try {
    return fn(storage);
  } finally {
    (globalThis as unknown as { window: unknown }).window = realWindow;
  }
}

test("saveCart/loadCart round-trips through storage", () => {
  withFakeWindow(() => {
    const cart = withLineQuantity(emptyCart("biz-a"), "p1", 2);
    saveCart(cart);
    const loaded = loadCart("biz-a");
    assert.deepEqual(loaded.lines, [{ productId: "p1", quantity: 2 }]);
  });
});

test("a cart saved for Business A never appears when loading Business B — namespaced by businessId", () => {
  withFakeWindow(() => {
    saveCart(withLineQuantity(emptyCart("biz-a"), "p1", 2));
    const loadedForB = loadCart("biz-b");
    assert.deepEqual(loadedForB.lines, [], "Business B must never see Business A's basket");
  });
});

test("loadCart falls back to an empty cart on corrupt JSON, never throws", () => {
  withFakeWindow((storage) => {
    storage.setItem(`skhokho:cart:v${CART_SCHEMA_VERSION}:biz-a`, "{not valid json");
    assert.doesNotThrow(() => loadCart("biz-a"));
    assert.deepEqual(loadCart("biz-a").lines, []);
  });
});

test("loadCart falls back to an empty cart for a mismatched schema version", () => {
  withFakeWindow((storage) => {
    storage.setItem(
      `skhokho:cart:v${CART_SCHEMA_VERSION}:biz-a`,
      JSON.stringify({ version: 999, businessId: "biz-a", lines: [{ productId: "p1", quantity: 1 }], updatedAt: new Date().toISOString() }),
    );
    assert.deepEqual(loadCart("biz-a").lines, []);
  });
});

test("loadCart falls back to an empty cart once the basket is older than CART_EXPIRY_MS", () => {
  withFakeWindow((storage) => {
    const stale = new Date(Date.now() - CART_EXPIRY_MS - 1000).toISOString();
    storage.setItem(
      `skhokho:cart:v${CART_SCHEMA_VERSION}:biz-a`,
      JSON.stringify({ version: CART_SCHEMA_VERSION, businessId: "biz-a", lines: [{ productId: "p1", quantity: 1 }], updatedAt: stale }),
    );
    assert.deepEqual(loadCart("biz-a").lines, []);
  });
});

test("loadCart sanitizes malformed individual lines rather than rejecting the whole cart", () => {
  withFakeWindow((storage) => {
    storage.setItem(
      `skhokho:cart:v${CART_SCHEMA_VERSION}:biz-a`,
      JSON.stringify({
        version: CART_SCHEMA_VERSION,
        businessId: "biz-a",
        lines: [
          { productId: "p1", quantity: 2 },
          { productId: "p2", quantity: "not-a-number" },
          { quantity: 3 }, // missing productId
          { productId: "p3", quantity: MAX_LINE_QUANTITY + 500 }, // over ceiling, still salvageable
        ],
        updatedAt: new Date().toISOString(),
      }),
    );
    const loaded = loadCart("biz-a");
    assert.deepEqual(
      loaded.lines.sort((a, b) => a.productId.localeCompare(b.productId)),
      [
        { productId: "p1", quantity: 2 },
        { productId: "p3", quantity: MAX_LINE_QUANTITY },
      ],
    );
  });
});

test("clearCart removes the stored basket for that business only", () => {
  withFakeWindow(() => {
    saveCart(withLineQuantity(emptyCart("biz-a"), "p1", 1));
    saveCart(withLineQuantity(emptyCart("biz-b"), "p1", 1));
    clearCart("biz-a");
    assert.deepEqual(loadCart("biz-a").lines, []);
    assert.deepEqual(loadCart("biz-b").lines, [{ productId: "p1", quantity: 1 }]);
  });
});

test("loadCart/saveCart never throw when window exists but localStorage itself throws (private browsing, quota, hardened settings)", () => {
  const realWindow = (globalThis as unknown as { window?: unknown }).window;
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem() {
        throw new Error("SecurityError");
      },
    },
  };
  try {
    assert.doesNotThrow(() => loadCart("biz-a"));
    assert.deepEqual(loadCart("biz-a").lines, []);
    assert.doesNotThrow(() => saveCart(withLineQuantity(emptyCart("biz-a"), "p1", 1)));
    assert.doesNotThrow(() => clearCart("biz-a"));
  } finally {
    (globalThis as unknown as { window: unknown }).window = realWindow;
  }
});

test("loadCart returns an empty cart when window is undefined (server-side)", () => {
  assert.deepEqual(loadCart("biz-a").lines, []);
});
