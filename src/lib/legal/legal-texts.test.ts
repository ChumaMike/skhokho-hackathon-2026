import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { LEGAL_DOCUMENTS, LEGAL_VERSION_PATTERN, TERMS_VERSION, PRIVACY_VERSION, isCurrentTermsVersion } from "./documents";
import { extractTitle, extractVersionLine } from "./markdown";
import termsGenerated from "./generated/terms-of-service";
import privacyGenerated from "./generated/privacy-notice";

/**
 * The one guarantee the legal pages make: what /terms and /privacy render
 * is byte-for-byte the markdown counsel reviewed in docs/legal/, and the
 * version the app records at checkout is the version printed on that text.
 * If either drifts, this fails before anything ships.
 */
const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

test("legal: generated terms and privacy texts match docs/legal/ (run `npm run legal:sync` after editing the markdown)", () => {
  assert.equal(termsGenerated.replace(/\r\n/g, "\n"), read(LEGAL_DOCUMENTS.terms.source));
  assert.equal(privacyGenerated.replace(/\r\n/g, "\n"), read(LEGAL_DOCUMENTS.privacy.source));
});

test("legal: the version constants equal the **Version:** line of each document and fit the acceptance pattern", () => {
  assert.equal(extractVersionLine(read(LEGAL_DOCUMENTS.terms.source)), TERMS_VERSION);
  assert.equal(extractVersionLine(read(LEGAL_DOCUMENTS.privacy.source)), PRIVACY_VERSION);
  assert.match(TERMS_VERSION, LEGAL_VERSION_PATTERN);
  assert.match(PRIVACY_VERSION, LEGAL_VERSION_PATTERN);
  assert.equal(LEGAL_DOCUMENTS.terms.version, TERMS_VERSION);
  assert.equal(LEGAL_DOCUMENTS.privacy.version, PRIVACY_VERSION);
});

test("legal: every draft carries the attorney-review heading, a version line and the operator's full name", () => {
  const drafts = [
    "docs/legal/terms-of-service.md",
    "docs/legal/privacy-notice.md",
    "docs/legal/merchant-terms.md",
    "docs/legal/ecta-storefront-information.md",
    "docs/legal/data-subject-request-process.md",
    "docs/legal/retention-schedule.md",
    "docs/legal/driver-terms.md",
    "docs/legal/driver-privacy-notice.md",
    "docs/legal/customer-delivery-notice.md",
    "docs/legal/pilot-merchant-agreement.md",
  ];
  for (const rel of drafts) {
    const md = read(rel);
    assert.match(md, /DRAFT FOR ATTORNEY REVIEW/, rel);
    assert.ok(extractVersionLine(md), `${rel} has no **Version:** line`);
    assert.ok(extractTitle(md), `${rel} has no title`);
    assert.match(md, /Skhokho Laboratory \("Skhokho Labs"\)/, `${rel} must name the operator in full`);
  }
});

test("legal: only the current terms version is accepted at checkout and booking", () => {
  assert.equal(isCurrentTermsVersion(TERMS_VERSION), true);
  assert.equal(isCurrentTermsVersion("v0.0-placeholder"), false);
  assert.equal(isCurrentTermsVersion(""), false);
  assert.equal(isCurrentTermsVersion(undefined), false);
  assert.equal(isCurrentTermsVersion(null), false);
});

test("legal: the draft flag is on until counsel signs off — the pages show it", () => {
  // Deliberate: flipping `draft` is a conscious act when the text is published, not a side effect.
  assert.equal(LEGAL_DOCUMENTS.terms.draft, true);
  assert.equal(LEGAL_DOCUMENTS.privacy.draft, true);
  assert.match(termsGenerated, /DRAFT FOR ATTORNEY REVIEW/);
});

test("legal: docs/legal/README.md (the marker register) is up to date (run `npm run legal:sync`)", () => {
  // The sync script owns the comparison; --check exits 1 and names the stale file.
  const result = spawnSync(process.execPath, ["scripts/legal/sync-legal-texts.mjs", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
