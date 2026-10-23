import test from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  CANCELLABLE_STATUSES,
  canTransitionOrder,
  assertOrderTransition,
  InvalidOrderTransitionError,
  COMPLETABLE_STATUSES,
} from "./order.service";

/** The order state machine as a table — pure, no database. */

test("the pipeline is PENDING → CONFIRMED → PROCESSING → READY → COMPLETED, with CANCELLED reachable from every non-terminal step", () => {
  assert.ok(canTransitionOrder("PENDING", "CONFIRMED"));
  assert.ok(canTransitionOrder("CONFIRMED", "PROCESSING"));
  assert.ok(canTransitionOrder("PROCESSING", "READY"));
  assert.ok(canTransitionOrder("READY", "COMPLETED"));
  for (const from of ["PENDING", "CONFIRMED", "PROCESSING", "READY"]) assert.ok(canTransitionOrder(from, "CANCELLED"), from);
  assert.deepEqual([...CANCELLABLE_STATUSES].sort(), ["CONFIRMED", "PENDING", "PROCESSING", "READY"]);
  assert.deepEqual([...COMPLETABLE_STATUSES], ["READY"]);
});

test("no step can be skipped, reversed, or repeated", () => {
  assert.equal(canTransitionOrder("PENDING", "READY"), false, "skip");
  assert.equal(canTransitionOrder("PENDING", "COMPLETED"), false, "skip to the end");
  assert.equal(canTransitionOrder("READY", "PROCESSING"), false, "reverse");
  assert.equal(canTransitionOrder("CONFIRMED", "CONFIRMED"), false, "repeat");
  assert.equal(canTransitionOrder("NOT_A_STATUS", "CONFIRMED"), false, "unknown");
});

test("terminal orders never move again — not even to CANCELLED", () => {
  for (const from of TERMINAL_ORDER_STATUSES) {
    assert.deepEqual(ORDER_TRANSITIONS[from], [], from);
    for (const to of ["PENDING", "CONFIRMED", "PROCESSING", "READY", "COMPLETED", "CANCELLED"]) {
      assert.equal(canTransitionOrder(from, to), false, `${from} -> ${to}`);
    }
  }
  assert.throws(() => assertOrderTransition("COMPLETED", "CANCELLED"), (e: unknown) => e instanceof InvalidOrderTransitionError && e.from === "COMPLETED" && e.to === "CANCELLED");
  assert.throws(() => assertOrderTransition("CANCELLED", "COMPLETED", "custom words"), /custom words/);
  assert.doesNotThrow(() => assertOrderTransition("READY", "COMPLETED"));
});
