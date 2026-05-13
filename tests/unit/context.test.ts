import { afterEach, beforeAll, describe, expect, it } from "bun:test";

import { resetTime, setFakeTime } from "../helpers/mock-time";

// Dynamic import so the mock above is in effect.
let formatContextForPrompt: typeof import("@/memory/context").formatContextForPrompt;
const testConfig = { injectProfile: true, maxProfileItems: 5 };

beforeAll(async () => {
  const mod = await import("@/memory/context");
  formatContextForPrompt = mod.formatContextForPrompt;
});

afterEach(() => {
  resetTime();
});

// Minimal stand-in for ProfileResponse — only the shape that
// formatContextForPrompt actually reads. Cast at the call site.
interface ProfileLike {
  profile: {
    static: unknown[];
    dynamic: unknown[];
  };
}

describe("formatContextForPrompt", () => {
  it("returns empty string when profile is null and both memory result sets are empty", () => {
    // Locks: when there is nothing to inject, the function returns "" so
    // the caller can skip prompt augmentation entirely (instead of
    // emitting a lonely "[SUPERMEMORY]" header).
    const out = formatContextForPrompt(null, {}, {}, testConfig);
    expect(out).toBe("");
  });

  it("renders a profile with only static facts (no memories) under a 'User Profile:' heading", () => {
    const profile = {
      profile: {
        static: ["Prefers concise responses", "Uses Bun"],
        dynamic: [],
      },
    } satisfies ProfileLike;
    const out = formatContextForPrompt(profile as unknown as Parameters<typeof formatContextForPrompt>[0], {}, {}, testConfig);
    expect(out).toMatchInlineSnapshot(`
"[SUPERMEMORY]

User Profile:
- Prefers concise responses
- Uses Bun"
`);
  });

  it("renders dynamic facts under 'Recent Context:' (separate section from static facts)", () => {
    const profile = {
      profile: {
        static: [],
        dynamic: ["Currently refactoring services/", "Asked about JSONC fixtures yesterday"],
      },
    } satisfies ProfileLike;
    const out = formatContextForPrompt(profile as unknown as Parameters<typeof formatContextForPrompt>[0], {}, {}, testConfig);
    expect(out).toMatchInlineSnapshot(`
"[SUPERMEMORY]

Recent Context:
- Currently refactoring services/
- Asked about JSONC fixtures yesterday"
`);
  });

  it("renders project memories with their rounded similarity percentage and 'memory' field", () => {
    const out = formatContextForPrompt(
      null,
      {},
      {
        results: [
          { similarity: 0.954, memory: "Uses Bun, not Node.js" },
          { similarity: 0.4, memory: "Build: bun run build" },
        ],
      },
      testConfig,
    );
    // Similarity is rounded with Math.round — 0.954 → 95%, 0.4 → 40%.
    expect(out).toMatchInlineSnapshot(`
"[SUPERMEMORY]

Project Knowledge:
- [95%] Uses Bun, not Node.js
- [40%] Build: bun run build"
`);
  });

  it("renders user memories under 'Relevant Memories:' and falls back to the 'chunk' field when 'memory' is missing", () => {
    const out = formatContextForPrompt(
      null,
      {
        results: [
          { similarity: 0.82, memory: "Prefers TypeScript over JavaScript" },
          // Note: no `memory` field; `chunk` is used as the fallback.
          { similarity: 0.6, chunk: "fallback-from-chunk-field" },
          // Note: similarity missing → treated as 0 (0%).
          { memory: "No similarity reported" },
        ],
      },
      {},
      testConfig,
    );
    expect(out).toMatchInlineSnapshot(`
"[SUPERMEMORY]

Relevant Memories:
- [82%] Prefers TypeScript over JavaScript
- [60%] fallback-from-chunk-field
- [0%] No similarity reported"
`);
  });

  it("extractFactText: object facts WITHOUT a 'content' string field fall back to JSON.stringify of the whole object", () => {
    // Locks the fallback in `extractFactText` — when a fact is an object
    // but its `content` property is not a string, the entire object is
    // serialized via JSON.stringify. This is a defensive fallback for
    // unexpected payload shapes from the Supermemory API.
    const profile = {
      profile: {
        // Mixed: a plain string, an object with `content`, and an object
        // without `content` (which exercises the JSON.stringify branch).
        static: ["plain-string-fact", { content: "object-with-content" }, { foo: "bar", n: 1 }],
        dynamic: [],
      },
    } satisfies ProfileLike;
    const out = formatContextForPrompt(profile as unknown as Parameters<typeof formatContextForPrompt>[0], {}, {}, testConfig);
    expect(out).toMatchInlineSnapshot(`
"[SUPERMEMORY]

User Profile:
- plain-string-fact
- object-with-content
- {"foo":"bar","n":1}"
`);
  });

  it("combined: profile + project memories + user memories render in the documented order (profile, project, user)", () => {
    const profile = {
      profile: {
        static: ["S1"],
        dynamic: ["D1"],
      },
    } satisfies ProfileLike;
    const out = formatContextForPrompt(
      profile as unknown as Parameters<typeof formatContextForPrompt>[0],
      { results: [{ similarity: 0.91, memory: "U1" }] },
      { results: [{ similarity: 0.77, memory: "P1" }] },
      testConfig,
    );
    expect(out).toMatchInlineSnapshot(`
"[SUPERMEMORY]

User Profile:
- S1

Recent Context:
- D1

Project Knowledge:
- [77%] P1

Relevant Memories:
- [91%] U1"
`);
  });

  it("dedupes lower-priority search results when the same fact appears in static profile facts", () => {
    const repeatedFact = "Uses Bun for project scripts";
    const profile = {
      profile: {
        static: [repeatedFact],
        dynamic: [],
      },
    } satisfies ProfileLike;

    const out = formatContextForPrompt(
      profile as unknown as Parameters<typeof formatContextForPrompt>[0],
      { results: [{ similarity: 0.92, memory: repeatedFact }] },
      {},
      { ...testConfig, profileCrossArrayDedup: true },
    );

    expect(out.match(new RegExp(repeatedFact, "g"))?.length).toBe(1);
    expect(out).toContain("User Profile:");
    expect(out).not.toContain("Relevant Memories:");
  });

  it("renders relative time for memory createdAt values without exposing the ISO timestamp", () => {
    setFakeTime("2026-01-15T12:00:00.000Z");
    const isoTimestamp = "2026-01-15T09:00:00.000Z";

    const out = formatContextForPrompt(
      null,
      { results: [{ similarity: 0.82, memory: "Prefers concise updates", createdAt: isoTimestamp }] },
      {},
      { ...testConfig, relativeTimeDisplay: true },
    );

    expect(out).toContain("3 hrs ago");
    expect(out).not.toContain(isoTimestamp);
  });

  it("appends the memo usage footer at the end when enabled", () => {
    const profile = {
      profile: {
        static: ["S1"],
        dynamic: ["D1"],
      },
    } satisfies ProfileLike;

    const out = formatContextForPrompt(
      profile as unknown as Parameters<typeof formatContextForPrompt>[0],
      { results: [{ similarity: 0.91, memory: "U1" }] },
      { results: [{ similarity: 0.77, memory: "P1" }] },
      { ...testConfig, memoUsageFooter: true },
    );

    expect(out.endsWith("[Supermemory: 4 memories loaded]")).toBe(true);
  });
});
