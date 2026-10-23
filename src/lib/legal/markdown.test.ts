import test from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseLegalMarkdown, slugifyHeading, extractVersionLine, extractTitle } from "./markdown";
import termsGenerated from "./generated/terms-of-service";
import privacyGenerated from "./generated/privacy-notice";

test("markdown: inline bold, code, links; attorney markers stay plain text", () => {
  assert.deepEqual(parseInline("plain **bold** and `code`"), [
    { kind: "text", text: "plain " },
    { kind: "strong", children: [{ kind: "text", text: "bold" }] },
    { kind: "text", text: " and " },
    { kind: "code", text: "code" },
  ]);
  assert.deepEqual(parseInline("see [the notice](/privacy) now"), [
    { kind: "text", text: "see " },
    { kind: "link", href: "/privacy", children: [{ kind: "text", text: "the notice" }] },
    { kind: "text", text: " now" },
  ]);
  // "[ATTORNEY: …]" has no "(url)" part — it must never become a link.
  assert.deepEqual(parseInline("**[ATTORNEY: confirm this]**"), [{ kind: "strong", children: [{ kind: "text", text: "[ATTORNEY: confirm this]" }] }]);
});

test("markdown: headings get stable ids; lists, quotes, tables, rules and code blocks parse", () => {
  const blocks = parseLegalMarkdown(
    [
      "# Title",
      "",
      "## 3. Skhokho Labs is the platform",
      "Para one",
      "continues here.",
      "",
      "- first",
      "- second **bold**",
      "",
      "1. one",
      "2. two",
      "",
      "> quoted **text**",
      "> more",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "| 3 | [x](/y) |",
      "",
      "---",
      "",
      "```",
      "code here",
      "```",
    ].join("\n"),
  );
  assert.equal(blocks[0].kind, "heading");
  assert.equal((blocks[1] as { id: string }).id, "3-skhokho-labs-is-the-platform");
  assert.deepEqual(blocks[2], { kind: "paragraph", children: [{ kind: "text", text: "Para one continues here." }] });
  assert.equal(blocks[3].kind, "list");
  assert.equal((blocks[3] as { ordered: boolean }).ordered, false);
  assert.equal((blocks[3] as { items: unknown[] }).items.length, 2);
  assert.equal((blocks[4] as { ordered: boolean }).ordered, true);
  assert.equal(blocks[5].kind, "quote");
  const table = blocks[6] as { kind: string; header: unknown[]; rows: unknown[][] };
  assert.equal(table.kind, "table");
  assert.equal(table.header.length, 2);
  assert.equal(table.rows.length, 2);
  assert.equal(blocks[7].kind, "rule");
  assert.deepEqual(blocks[8], { kind: "code", text: "code here" });
});

test("markdown: slugs are url-safe and bounded", () => {
  assert.equal(slugifyHeading("16. Contact"), "16-contact");
  assert.equal(slugifyHeading("Who we are — and what these terms cover!"), "who-we-are-and-what-these-terms-cover");
  assert.ok(slugifyHeading("x".repeat(200)).length <= 80);
});

test("markdown: the real terms and privacy texts parse into headings, paragraphs and tables without an unknown block", () => {
  for (const md of [termsGenerated, privacyGenerated]) {
    const blocks = parseLegalMarkdown(md);
    assert.ok(blocks.length > 20);
    assert.equal(blocks[0].kind, "heading");
    assert.ok(blocks.some((b) => b.kind === "table"), "the change log table parses");
    assert.ok(blocks.some((b) => b.kind === "list"));
    assert.ok(extractVersionLine(md));
    assert.ok(extractTitle(md));
  }
});
