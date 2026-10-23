import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BUSINESS_CATEGORIES } from "@/lib/business-categories";

/**
 * The storefront-websites audit (docs/specs/2026-10-21-storefront-websites.md)
 * must keep one row per real business category — adding a category to the
 * enum without deciding what its website needs is exactly the drift this
 * workstream exists to end.
 */
const AUDIT = path.join(process.cwd(), "docs", "specs", "2026-10-21-storefront-websites.md");

test("the storefront-websites audit has a row for every business category", () => {
  const doc = readFileSync(AUDIT, "utf8");
  const tableStart = doc.indexOf("| Category | Variant");
  assert.ok(tableStart > 0, "per-category table is missing");
  const table = doc.slice(tableStart, doc.indexOf("\n\n", tableStart));
  for (const [id] of BUSINESS_CATEGORIES) {
    assert.match(table, new RegExp(`^\\| ${id} \\|`, "m"), `${id} has no row in the audit table`);
  }
  // Every row carries a fit verdict so nothing is left undecided.
  const rows = table.split("\n").filter((line) => /^\| [A-Z_]+ \|/.test(line));
  assert.equal(rows.length, BUSINESS_CATEGORIES.length);
  for (const row of rows) assert.match(row, /\| [✔◐✘] \|$/, `no fit verdict: ${row}`);
});

test("the audit classifies each of the five older storefront branches", () => {
  const doc = readFileSync(AUDIT, "utf8");
  for (const branch of [
    "storefront/m4-multi-page-routes",
    "storefront/m5-templates-and-wizard",
    "storefront/m5b-storefront-seo",
    "storefront/m6-ai-generation-fallback",
    "storefront/nav-and-dead-fields",
  ]) {
    const row = doc.split("\n").find((line) => line.includes(`\`${branch}\``));
    assert.ok(row, `${branch} is not in the branch table`);
    assert.match(row, /Superseded|Reusable|Conflicting/, `${branch} has no verdict`);
  }
});
