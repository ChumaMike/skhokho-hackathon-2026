import test from "node:test";
import assert from "node:assert/strict";
import { BoundedTtlCache } from "./bounded-cache";

test("never holds more than maxEntries, however many distinct keys arrive", () => {
  const cache = new BoundedTtlCache<number>(3, 60_000);
  for (let i = 0; i < 1_000; i++) cache.set(`random-${i}.example.com`, i);
  assert.equal(cache.size, 3);
  assert.equal(cache.get("random-999.example.com"), 999);
  assert.equal(cache.get("random-0.example.com"), undefined);
});

test("evicts the least recently written key first", () => {
  const cache = new BoundedTtlCache<string>(2, 60_000);
  cache.set("a", "A");
  cache.set("b", "B");
  cache.set("a", "A2"); // rewrite moves a to the back
  cache.set("c", "C");
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), "A2");
  assert.equal(cache.get("c"), "C");
});

test("entries expire after the TTL", () => {
  let now = 1_000;
  const cache = new BoundedTtlCache<string>(10, 50, () => now);
  cache.set("tenant-a.example", "A");
  now += 49;
  assert.equal(cache.get("tenant-a.example"), "A");
  now += 1;
  assert.equal(cache.get("tenant-a.example"), undefined);
  assert.equal(cache.size, 0);
});

test("keys are exact: one tenant's entry is never returned for another key", () => {
  const cache = new BoundedTtlCache<string>(10, 60_000);
  cache.set("a.skhokholabs.app", "A");
  cache.set("b.skhokholabs.app", "B");
  assert.equal(cache.get("a.skhokholabs.app"), "A");
  assert.equal(cache.get("b.skhokholabs.app"), "B");
  assert.equal(cache.get("c.skhokholabs.app"), undefined);
});
