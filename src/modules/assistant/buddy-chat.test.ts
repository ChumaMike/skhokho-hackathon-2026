import test from "node:test";
import assert from "node:assert/strict";
import { MAX_QUESTION_LENGTH, validateBuddyQuestion } from "./buddy-chat";

test("trims a normal question", () => {
  assert.deepEqual(validateBuddyQuestion("  who is lapsed?  "), { ok: true, question: "who is lapsed?" });
});

test("rejects empty, whitespace-only and non-string input", () => {
  for (const raw of ["", "   ", undefined, null, 42]) {
    const result = validateBuddyQuestion(raw);
    assert.equal(result.ok, false);
  }
});

test("accepts a question exactly at the limit and rejects one over it", () => {
  assert.equal(validateBuddyQuestion("a".repeat(MAX_QUESTION_LENGTH)).ok, true);
  const over = validateBuddyQuestion("a".repeat(MAX_QUESTION_LENGTH + 1));
  assert.equal(over.ok, false);
});
