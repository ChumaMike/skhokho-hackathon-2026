import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHostname, extractSubdomain, RESERVED_SUBDOMAINS, PLATFORM_DOMAIN } from "./context";

// These tests assume the module's own default ("skhokho.sgdataint.co.za"),
// which is what applies whenever PLATFORM_DOMAIN isn't set in the
// environment — true for a plain `pnpm run test` run (no --env-file). If
// .env.local's PLATFORM_DOMAIN ever diverges from the code default, this
// assertion fails loudly here instead of every test below silently
// exercising the wrong domain.
assert.equal(PLATFORM_DOMAIN, "skhokho.sgdataint.co.za");

// ---------------------------------------------------------------------------
// normalizeHostname — pure, no DB
// ---------------------------------------------------------------------------

test("normalizeHostname lowercases", () => {
  assert.equal(normalizeHostname("Nomsa.skhokho.sgdataint.co.za"), "nomsa.skhokho.sgdataint.co.za");
});

test("normalizeHostname strips a port", () => {
  assert.equal(normalizeHostname("nomsa.skhokho.sgdataint.co.za:3002"), "nomsa.skhokho.sgdataint.co.za");
});

test("normalizeHostname trims whitespace", () => {
  assert.equal(normalizeHostname("  nomsa.skhokho.sgdataint.co.za  "), "nomsa.skhokho.sgdataint.co.za");
});

test("normalizeHostname strips a DNS trailing dot", () => {
  assert.equal(normalizeHostname("nomsa.skhokho.sgdataint.co.za."), "nomsa.skhokho.sgdataint.co.za");
});

// ---------------------------------------------------------------------------
// extractSubdomain — pure, no DB
// ---------------------------------------------------------------------------

test("extractSubdomain returns the slug for a platform subdomain, surface STOREFRONT", () => {
  assert.deepEqual(extractSubdomain("nomsa.skhokho.sgdataint.co.za"), { slug: "nomsa", surface: "STOREFRONT" });
});

test("extractSubdomain is case-insensitive", () => {
  assert.deepEqual(extractSubdomain("NOMSA.SKHOKHO.SGDATAINT.CO.ZA"), { slug: "nomsa", surface: "STOREFRONT" });
});

test("extractSubdomain strips a port before matching", () => {
  assert.deepEqual(extractSubdomain("nomsa.skhokho.sgdataint.co.za:3002"), { slug: "nomsa", surface: "STOREFRONT" });
});

test("extractSubdomain returns null for the bare platform domain", () => {
  assert.equal(extractSubdomain("skhokho.sgdataint.co.za"), null);
});

test("extractSubdomain returns null for an unrelated domain", () => {
  assert.equal(extractSubdomain("example.com"), null);
});

test("extractSubdomain returns null for a domain that merely ends with the platform domain as a substring", () => {
  // "notskhokho.sgdataint.co.za" ends with "skhokho.sgdataint.co.za" as a raw string, but is a
  // different registrable domain, not a subdomain of it — must not match.
  assert.equal(extractSubdomain("notskhokho.sgdataint.co.za"), null);
});

test("extractSubdomain handles <slug>.localhost for local dev", () => {
  assert.deepEqual(extractSubdomain("nomsa.localhost"), { slug: "nomsa", surface: "STOREFRONT" });
});

test("extractSubdomain returns null for bare localhost", () => {
  assert.equal(extractSubdomain("localhost"), null);
});

// ---------------------------------------------------------------------------
// extractSubdomain — surface infix (Phase 4)
// ---------------------------------------------------------------------------

test("extractSubdomain parses a .bookings surface infix", () => {
  assert.deepEqual(extractSubdomain("nomsa.bookings.skhokho.sgdataint.co.za"), { slug: "nomsa", surface: "BOOKINGS" });
});

test("extractSubdomain parses an .admin surface infix", () => {
  assert.deepEqual(extractSubdomain("nomsa.admin.skhokho.sgdataint.co.za"), { slug: "nomsa", surface: "ADMIN" });
});

test("extractSubdomain parses a .bookings surface infix for local dev", () => {
  assert.deepEqual(extractSubdomain("nomsa.bookings.localhost"), { slug: "nomsa", surface: "BOOKINGS" });
});

test("extractSubdomain treats an unrecognized dotted label as one opaque slug, not a surface", () => {
  assert.deepEqual(extractSubdomain("nomsa.other.skhokho.sgdataint.co.za"), { slug: "nomsa.other", surface: "STOREFRONT" });
});

// ---------------------------------------------------------------------------
// RESERVED_SUBDOMAINS
// ---------------------------------------------------------------------------

test("RESERVED_SUBDOMAINS blocks admin", () => {
  assert.ok(RESERVED_SUBDOMAINS.has("admin"));
});

test("RESERVED_SUBDOMAINS blocks bookings", () => {
  // <slug>.bookings.<platform> is a real surface (Phase 4) — "bookings"
  // must be reserved, or a business could claim it as its own bare slug
  // and collide with the surface-infix meaning of the word.
  assert.ok(RESERVED_SUBDOMAINS.has("bookings"));
});
