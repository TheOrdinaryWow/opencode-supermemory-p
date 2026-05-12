import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stripJsoncComments } from "../../src/shared/jsonc.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const FIXTURE_DIR = join(REPO_ROOT, "tests", "fixtures", "configs");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf-8");
}

describe("stripJsoncComments — fixture characterization", () => {
  it("minimal.jsonc: no comments to strip; output round-trips through JSON.parse", () => {
    const input = readFixture("minimal.jsonc");
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed).toEqual({ apiKey: "sm_test_minimal_0001" });
  });

  it("maximal.jsonc: every config field survives stripping and parses", () => {
    const input = readFixture("maximal.jsonc");
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed).toEqual({
      apiKey: "sm_test_maximal_0002",
      similarityThreshold: 0.72,
      maxMemories: 8,
      maxProjectMemories: 12,
      maxProfileItems: 6,
      injectProfile: true,
      containerTagPrefix: "omsm-test",
      userContainerTag: "team-platform",
      projectContainerTag: "opencode-supermemory-fixture",
      filterPrompt: "Test filter prompt. Remember user preferences only.",
      keywordPatterns: ["log\\s+this", "write\\s+down"],
      compactionThreshold: 0.75,
    });
  });

  it("with-comments.jsonc: strips // line and /* */ block comments, output parses", () => {
    const input = readFixture("with-comments.jsonc");
    const stripped = stripJsoncComments(input);
    // No comment markers remain (the only `//` or `/*` that could appear is inside strings, but this fixture has none)
    expect(stripped).not.toContain("//");
    expect(stripped).not.toContain("/*");
    expect(stripped).not.toContain("*/");
    const parsed = JSON.parse(stripped);
    expect(parsed).toEqual({
      apiKey: "sm_test_with_comments_0003",
      similarityThreshold: 0.65,
      maxMemories: 5,
      injectProfile: true,
      containerTagPrefix: "omsm",
    });
  });

  it("with-trailing-commas.jsonc: strips trailing commas before } and ], output parses", () => {
    const input = readFixture("with-trailing-commas.jsonc");
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed).toEqual({
      apiKey: "sm_test_trailing_commas_0004",
      similarityThreshold: 0.6,
      maxMemories: 5,
      keywordPatterns: ["remember", "save\\s+this", "note\\s+this"],
      compactionThreshold: 0.8,
    });
  });

  it("mixed-quotes.jsonc: preserves escaped quotes, URLs, and fake comments inside strings", () => {
    const input = readFixture("mixed-quotes.jsonc");
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    // Escaped quote literal is preserved inside the string value.
    expect(parsed.apiKey).toBe('sm_test_mixed_"quotes"_0005');
    // `//` and `/* */` sequences that live inside a JSON string must NOT be treated as comments.
    expect(parsed.filterPrompt).toContain("// not-a-comment");
    expect(parsed.filterPrompt).toContain("/* still-not-a-comment */");
    // URL-like substrings (with `://`) inside strings survive.
    expect(parsed.keywordPatterns).toEqual(["url:\\s*https?://[^\\s]+", "path:\\s*/[^\\s]+", "comment\\s*//.*", "block\\s*/\\*.*\\*/"]);
    // `\"` literal inside the value is preserved as a real double-quote.
    expect(parsed.containerTagPrefix).toBe('omsm-mixed-"escapes"');
  });

  it("malformed.jsonc: stripJsoncComments does NOT throw, JSON.parse on its output DOES throw", () => {
    const input = readFixture("malformed.jsonc");
    // Locks current behavior: the stripper is forgiving — it only deals in
    // comments and trailing commas, NOT structural validity. JSON.parse is
    // responsible for surfacing structural errors.
    expect(() => stripJsoncComments(input)).not.toThrow();
    const stripped = stripJsoncComments(input);
    expect(() => JSON.parse(stripped)).toThrow();
    // Inline snapshot pins the exact textual output so future refactors are intentional.
    expect(stripped).toMatchInlineSnapshot(`
"{
  "apiKey": "sm_test_malformed_0006",
  "similarityThreshold": 0.7,
  "maxMemories": 5
  
  "injectProfile": true
"
`);
  });
});

describe("stripJsoncComments — boundary cases", () => {
  it("empty string returns empty string", () => {
    expect(stripJsoncComments("")).toBe("");
  });

  it("file containing only a // line comment yields a blank line", () => {
    // Current behavior: single-line comment is stripped but the trailing
    // newline that terminated it is preserved.
    expect(stripJsoncComments("// just a comment\n")).toBe("\n");
  });

  it("URL inside a string value is NOT treated as a comment", () => {
    const input = '{"url": "http://example.com/path"}';
    const stripped = stripJsoncComments(input);
    expect(stripped).toBe(input);
    expect(JSON.parse(stripped)).toEqual({ url: "http://example.com/path" });
  });

  it("escaped backslash followed by quote correctly toggles string state", () => {
    // `"a\\"` is the JSON literal: a, then backslash, then end-quote.
    // The stripper must NOT treat the `\\"` as an escaped quote — the
    // backslash itself is escaped (even count), so the quote closes the
    // string. Anything after it must be eligible for comment stripping.
    const input = '{"x":"a\\\\"  // tail comment\n}';
    const stripped = stripJsoncComments(input);
    expect(stripped).not.toContain("// tail comment");
    expect(JSON.parse(stripped)).toEqual({ x: "a\\" });
  });

  it("nested /* /* */ */ block comments: only the FIRST */ closes the comment (no nesting)", () => {
    // Current behavior: the parser is non-recursive. Once inside a /* */
    // block, the first `*/` ends it — anything after is treated as live
    // code. This is standard JSONC semantics; we lock it here.
    const input = "/* outer /* inner */ tail */ KEEP";
    const stripped = stripJsoncComments(input);
    expect(stripped).toBe(" tail */ KEEP");
  });
});
