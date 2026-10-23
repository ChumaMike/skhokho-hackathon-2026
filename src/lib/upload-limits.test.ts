import test from "node:test";
import assert from "node:assert/strict";
import { MAX_UPLOAD_BYTES, SERVER_ACTION_BODY_LIMIT, uploadTooLarge, uploadTooLargeMessage } from "./upload-limits";
import nextConfig from "../../next.config";

/** The settings-save fix (2026-10-21 incident): one limit, enforced before the upload and allowed by the server. */

test("the limit sits under Vercel's 4.5 MB body cap and above a typical phone photo", () => {
  assert.equal(MAX_UPLOAD_BYTES, 4 * 1024 * 1024);
  assert.equal(uploadTooLarge(MAX_UPLOAD_BYTES), false);
  assert.equal(uploadTooLarge(MAX_UPLOAD_BYTES + 1), true);
  assert.equal(uploadTooLarge(2.5 * 1024 * 1024), false, "a 2.5 MB phone photo is fine");
});

test("the message says the size and what to do, in plain words", () => {
  const msg = uploadTooLargeMessage(6.2 * 1024 * 1024);
  assert.match(msg, /6\.2 MB/);
  assert.match(msg, /under 4 MB/);
  assert.match(msg, /screenshot/);
});

test("next.config raises the Server Action body limit above Next's 1 MB default, in step with the upload limit", () => {
  const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;
  assert.equal(limit, SERVER_ACTION_BODY_LIMIT);
  const kb = Number(String(limit).replace(/kb$/, ""));
  assert.ok(kb * 1024 > MAX_UPLOAD_BYTES, "room for the image plus the text fields");
  assert.ok(kb * 1024 <= 4.5 * 1024 * 1024, "never above what Vercel accepts");
});
