import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSlug,
  validateSlug,
  reservedSlugCategory,
  slugCandidates,
  RESERVED_SLUG_POLICY,
  SLUG_MAX_LENGTH,
  MAX_NUMBERED_CANDIDATES,
} from "./slug-policy";

// ---------------------------------------------------------------------------
// normalizeSlug
// ---------------------------------------------------------------------------

test("normalizeSlug turns a business name into a DNS-safe label", () => {
  assert.equal(normalizeSlug("Kota-Tainment"), "kota-tainment");
  assert.equal(normalizeSlug("Kota Tainment (Soweto)"), "kota-tainment-soweto");
  assert.equal(normalizeSlug("  Mama's   Kitchen!!  "), "mamas-kitchen");
});

test("normalizeSlug strips accents rather than dropping letters", () => {
  assert.equal(normalizeSlug("Café Süd"), "cafe-sud");
  assert.equal(normalizeSlug("Ñandú Braids"), "nandu-braids");
});

test("normalizeSlug spells out & and collapses separators", () => {
  assert.equal(normalizeSlug("Hair & Nails"), "hair-and-nails");
  assert.equal(normalizeSlug("a__b--c..d"), "a-b-c-d");
});

test("normalizeSlug never leaves a leading or trailing hyphen", () => {
  assert.equal(normalizeSlug("--Shisanyama--"), "shisanyama");
  assert.equal(normalizeSlug("!!!"), "");
});

test("normalizeSlug returns nothing usable for a name with no Latin letters or digits", () => {
  assert.equal(normalizeSlug("☕🍔"), "");
  assert.equal(normalizeSlug("Ημέρα"), "");
});

test("normalizeSlug caps at the 63-char DNS label limit, preferring a word boundary", () => {
  const long = "the best kota and chips spot in the whole of soweto and surrounding areas";
  const slug = normalizeSlug(long);
  assert.ok(slug.length <= SLUG_MAX_LENGTH);
  assert.ok(!slug.endsWith("-"));
  assert.ok(long.replace(/ /g, "-").startsWith(slug), "cut at a word boundary");
  assert.equal(normalizeSlug("a".repeat(100)).length, SLUG_MAX_LENGTH);
});

// ---------------------------------------------------------------------------
// validateSlug / reserved names
// ---------------------------------------------------------------------------

test("validateSlug accepts an ordinary slug", () => {
  assert.deepEqual(validateSlug("kota-tainment"), { ok: true });
  assert.deepEqual(validateSlug("shop-24"), { ok: true });
});

test("validateSlug rejects malformed slugs", () => {
  assert.equal((validateSlug("ab") as { problem: string }).problem, "TOO_SHORT");
  assert.equal((validateSlug("a".repeat(64)) as { problem: string }).problem, "TOO_LONG");
  for (const bad of ["Kota", "kota_tainment", "kota--tainment", "-kota", "kota-", "kota.tainment", "kota tainment"]) {
    assert.equal((validateSlug(bad) as { problem: string }).problem, "INVALID_CHARACTERS", bad);
  }
});

test("validateSlug rejects punycode labels (homograph risk)", () => {
  assert.equal((validateSlug("xn--80ak6aa92e") as { problem: string }).problem, "PUNYCODE");
});

test("every reserved name is rejected, whatever its category", () => {
  for (const [category, names] of Object.entries(RESERVED_SLUG_POLICY)) {
    for (const name of names) {
      if (name.length < 3) continue; // fails TOO_SHORT first — still unusable
      const result = validateSlug(name);
      assert.equal(result.ok, false, name);
      assert.equal((result as { problem: string }).problem, "RESERVED", name);
      assert.equal((result as { category: string }).category, category, name);
    }
  }
});

test("infrastructure-sensitive names from the brief are all reserved", () => {
  for (const name of ["app", "admin", "api", "www", "mail", "support", "billing", "login", "signup", "dashboard", "docs", "status", "help"]) {
    assert.ok(reservedSlugCategory(name), name);
  }
});

test("/store/<static> route segments are reserved so no slug is shadowed by a real route", () => {
  assert.equal(reservedSlugCategory("pay"), "APP_ROUTES");
  assert.equal(reservedSlugCategory("order"), "APP_ROUTES");
});

test("brand names block their prefixes too, but not unrelated words containing them", () => {
  assert.equal(reservedSlugCategory("skhokho"), "BRAND");
  assert.equal(reservedSlugCategory("skhokho-official"), "BRAND");
  assert.equal(reservedSlugCategory("mama-skhokho-eats"), null);
});

test("ordinary business names are not reserved", () => {
  for (const name of ["kota-tainment", "beauty-by-nomsa", "shop", "soweto-shisanyama"]) {
    assert.equal(reservedSlugCategory(name), null, name);
  }
});

// ---------------------------------------------------------------------------
// slugCandidates — deterministic collision handling
// ---------------------------------------------------------------------------

test("slugCandidates is deterministic: name, then location, then numbers", () => {
  const candidates = slugCandidates("Kota-Tainment", { suburb: "Soweto", city: "Johannesburg" });
  assert.deepEqual(candidates.slice(0, 5), [
    "kota-tainment",
    "kota-tainment-soweto",
    "kota-tainment-johannesburg",
    "kota-tainment-2",
    "kota-tainment-3",
  ]);
  assert.deepEqual(slugCandidates("Kota-Tainment", { suburb: "Soweto", city: "Johannesburg" }), candidates);
});

test("slugCandidates never exposes a random or internal id", () => {
  const candidates = slugCandidates("Kota-Tainment", { suburb: "Soweto" });
  assert.ok(candidates.every((candidate) => /^kota-tainment(-soweto|-\d+)?$/.test(candidate)));
  assert.equal(candidates.at(-1), `kota-tainment-${MAX_NUMBERED_CANDIDATES}`);
});

test("slugCandidates only ever offers valid, unique slugs", () => {
  for (const name of ["Kota-Tainment", "Admin", "Zo", "☕", "Skhokho", "x".repeat(80), "Help Desk"]) {
    const candidates = slugCandidates(name, { suburb: "Soweto", city: "Johannesburg" });
    assert.ok(candidates.length > 0, name);
    assert.equal(new Set(candidates).size, candidates.length, name);
    for (const candidate of candidates) assert.ok(validateSlug(candidate).ok, `${name} → ${candidate}`);
  }
});

test("a reserved name moves straight to its location / numbered variants", () => {
  const candidates = slugCandidates("Admin", { suburb: "Soweto" });
  assert.equal(candidates[0], "admin-soweto");
  assert.ok(!candidates.includes("admin"));
});

test("a too-short or non-Latin name borrows the location before going generic", () => {
  assert.equal(slugCandidates("Zo", { suburb: "Soweto" })[0], "zo-soweto");
  assert.equal(slugCandidates("☕", { suburb: "Soweto" })[0], "soweto");
  assert.equal(slugCandidates("☕")[0], "my-shop");
});

test("a brand-reserved name falls back to the generic base instead of producing nothing", () => {
  assert.equal(slugCandidates("Skhokho")[0], "my-shop");
});

test("numbered candidates stay within the DNS label limit for very long names", () => {
  const candidates = slugCandidates("x".repeat(80));
  assert.ok(candidates.every((candidate) => candidate.length <= SLUG_MAX_LENGTH));
  assert.ok(candidates.includes(`${"x".repeat(SLUG_MAX_LENGTH - 3)}-50`));
});
