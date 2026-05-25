/**
 * Regression net for real-world scaffolding leaks.
 *
 * Each `.txt` file under `tests/fixtures/leaked-prompts/` is content a
 * previous build of this plugin captured as a memory when it should
 * have stripped the entire payload. The asserts below codify "this
 * shape is scaffolding" so:
 *
 *   1. Future strip-pattern changes can't silently regress.
 *   2. New leaks are added as a fixture FIRST (red), then fixed (green).
 *
 * If a new fixture you just added is failing this test, the
 * SCAFFOLDING_PATTERNS / POLLUTION_PATTERNS lists need a new entry.
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { POLLUTION_PATTERNS as PURGE_PATTERNS } from "@/../scripts/purge-injected";
import { createPromptBoundary, isPolluted } from "@/shared/user-prompt";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "leaked-prompts");

const fixtures = readdirSync(FIXTURES_DIR)
  .filter((name) => name.endsWith(".txt"))
  .map((name) => ({ name, content: readFileSync(join(FIXTURES_DIR, name), "utf-8") }));

if (fixtures.length === 0) {
  throw new Error(`No leaked-prompt fixtures found in ${FIXTURES_DIR}`);
}

describe("leaked-prompt fixtures — regression net", () => {
  for (const { name, content } of fixtures) {
    describe(name, () => {
      it("is detected by isPolluted (capture should skip)", () => {
        expect(isPolluted(content)).toBe(true);
      });

      it("createPromptBoundary strips the scaffolding to nothing user-visible", () => {
        const boundary = createPromptBoundary([{ type: "text", text: content }]);
        // The fixture is 100% scaffolding (or scaffolding + tiny task tail
        // that the strip patterns also remove). userText should be empty
        // OR contain only the genuine post-scaffolding user content for
        // fixtures that intentionally mix.
        expect(boundary.userText.length).toBeLessThan(content.length / 2);
        expect(boundary.isPolluted).toBe(true);
      });

      it("matches the purge script's pollution patterns (legacy memories cleanable)", () => {
        const matched = PURGE_PATTERNS.some((pattern) => pattern.test(content));
        expect(matched).toBe(true);
      });
    });
  }
});
