import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSAPhone, whatsappLink } from "./utils";
import { ABOUT_FALLBACK_HEADING, aboutHeading } from "./storefront/about-heading";

// B11 — one canonical South African number → WhatsApp link.

test("SA numbers in every common format become the same wa.me link", () => {
  for (const raw of ["082 123 4567", "0821234567", "082-123-4567", "(082) 123 4567", "27821234567", "+27 82 123 4567", "+27821234567", "0027 82 123 4567", " 082 123 4567 "]) {
    assert.equal(whatsappLink(raw), "https://wa.me/27821234567", raw);
  }
});

test("a local number is never turned into a dead wa.me/0… link", () => {
  assert.doesNotMatch(whatsappLink("0821234567") ?? "", /wa\.me\/0/);
});

test("malformed or foreign numbers give no link at all", () => {
  for (const raw of ["", "   ", "12345", "082 123 456", "082 123 45678", "+44 7911 123456", "+1 415 555 0100", "abc", "27 82 123 456"]) {
    assert.equal(whatsappLink(raw), null, raw);
  }
  assert.equal(whatsappLink(null), null);
  assert.equal(whatsappLink(undefined), null);
});

test("a prefilled message is URL-encoded", () => {
  assert.equal(
    whatsappLink("082 123 4567", "Hi Kota & Co, I'd like to ask about braids?"),
    "https://wa.me/27821234567?text=Hi%20Kota%20%26%20Co%2C%20I'd%20like%20to%20ask%20about%20braids%3F",
  );
});

test("normalizeSAPhone stores one form: +27XXXXXXXXX", () => {
  assert.equal(normalizeSAPhone("082 123 4567"), "+27821234567");
  assert.equal(normalizeSAPhone("0027821234567"), "+27821234567");
  assert.equal(normalizeSAPhone("0821234"), null);
});

// B12 — the About heading is the business's own words or a neutral label.

test("About heading: tagline above a longer story; neutral otherwise; never merchant advice", () => {
  assert.equal(aboutHeading("We started grilling in Soweto in a backyard...", "Soweto kotas, chips and cold drinks."), "Soweto kotas, chips and cold drinks.");
  assert.equal(aboutHeading(undefined, "Soweto kotas."), ABOUT_FALLBACK_HEADING, "description is already the body text — don't repeat it");
  assert.equal(aboutHeading("Same words.", "Same words."), ABOUT_FALLBACK_HEADING);
  assert.equal(aboutHeading("Story.", "x".repeat(91)), ABOUT_FALLBACK_HEADING, "a long description isn't a heading");
  assert.equal(aboutHeading(null, null), ABOUT_FALLBACK_HEADING);
  for (const h of [aboutHeading("a", "b"), aboutHeading(null, null)]) assert.doesNotMatch(h, /Give customers a reason/);
});
