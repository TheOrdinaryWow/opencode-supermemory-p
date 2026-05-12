import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { containsPrivateTag, isFullyPrivate, stripPrivateContent } from "@/memory/privacy";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const FIXTURE_DIR = join(REPO_ROOT, "tests", "fixtures", "messages");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf-8");
}

describe("containsPrivateTag", () => {
  it("returns true when a properly closed <private> tag is present", () => {
    const input = readFixture("with-private-tag.md");
    expect(containsPrivateTag(input)).toBe(true);
  });

  it("returns false when no <private> tag is present", () => {
    const input = readFixture("with-code-blocks.md");
    expect(containsPrivateTag(input)).toBe(false);
  });
});

describe("stripPrivateContent", () => {
  it("redacts each <private>...</private> block individually (with-private-tag fixture)", () => {
    const input = readFixture("with-private-tag.md");
    const out = stripPrivateContent(input);
    expect(out).toMatchInlineSnapshot(`
"Here is some public information about the deployment workflow.

The API key is [REDACTED] and must never be logged.

The database password is also sensitive: [REDACTED].

Public summary: we deploy via GitHub Actions every Tuesday at 10:00 UTC.
"
`);
    // Sanity: secret payloads must not survive redaction.
    expect(out).not.toContain("sm_supersecret_abc123xyz");
    expect(out).not.toContain("db-pw-9f3a7b");
  });

  it("redacts MULTIPLE private blocks in the same input (each block → one [REDACTED])", () => {
    const input = "before <private>a</private> middle <private>b</private> after";
    expect(stripPrivateContent(input)).toBe("before [REDACTED] middle [REDACTED] after");
  });

  it("nested private tags: outer <private>...</private> is matched non-greedily, leaving the inner closing tag visible", () => {
    // Current behavior (locked): the regex is non-greedy (`*?`), so for
    // `<private>a<private>b</private>c</private>`, it matches the SHORTEST
    // span — `<private>a<private>b</private>` — and the trailing
    // `c</private>` is left as plain text. This is a quirk of regex-based
    // matching, NOT a true HTML parser. May need fixing if real nesting
    // must be supported.
    const input = "X <private>a<private>b</private>c</private> Y";
    expect(stripPrivateContent(input)).toBe("X [REDACTED]c</private> Y");
  });

  it("unclosed <private> tag is NOT redacted (left in place verbatim)", () => {
    // Current behavior (locked): the regex requires a matching `</private>`
    // somewhere in the rest of the input. An unclosed tag is simply
    // passed through, meaning the supposed-secret payload AFTER the tag
    // would still be visible. May need fixing — consider treating
    // unclosed tags as "redact to end of string" if security matters.
    const input = "head <private>oops no closer";
    expect(stripPrivateContent(input)).toBe("head <private>oops no closer");
    // Secret content leaks through:
    expect(stripPrivateContent(input)).toContain("oops");
  });
});

describe("isFullyPrivate", () => {
  it("returns true when the entire (trimmed) message is one <private> block (fully-private fixture)", () => {
    const input = readFixture("fully-private.md");
    expect(isFullyPrivate(input)).toBe(true);
  });

  it("returns false when only PART of the message is wrapped in <private> (with-private-tag fixture)", () => {
    const input = readFixture("with-private-tag.md");
    expect(isFullyPrivate(input)).toBe(false);
  });

  it("returns false when no <private> tag is present (with-code-blocks fixture)", () => {
    const input = readFixture("with-code-blocks.md");
    expect(isFullyPrivate(input)).toBe(false);
  });

  it("returns true for an empty string — current behavior since strip→trim yields '' which the function treats as fully-private", () => {
    // Current behavior (locked): empty input has no payload at all, but
    // the function returns true because the empty string matches the
    // second branch (`stripped === ""`). Callers should NOT rely on this
    // to mean "the user wrote a real private message"; it is an
    // accidental side-effect of the `|| stripped === ""` clause.
    expect(isFullyPrivate("")).toBe(true);
  });
});
