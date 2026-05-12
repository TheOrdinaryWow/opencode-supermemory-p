import { beforeAll, describe, expect, it, mock } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// We mock `src/config.ts` BEFORE context.ts is imported so that the
// behavior under test is independent of whatever lives on the developer's
// machine (`~/.config/opencode/supermemory.jsonc`). The mocked CONFIG
// uses the documented defaults from src/config.ts (DEFAULTS).
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const CONFIG_ABS = join(REPO_ROOT, "src", "config.ts");

mock.module(CONFIG_ABS, () => ({
  CONFIG: {
    injectProfile: true,
    maxProfileItems: 5,
    similarityThreshold: 0.6,
    maxMemories: 5,
    maxProjectMemories: 10,
    containerTagPrefix: "opencode",
    userContainerTag: undefined,
    projectContainerTag: undefined,
    filterPrompt: "",
    keywordPatterns: [],
    compactionThreshold: 0.8,
  },
  SUPERMEMORY_API_KEY: "test-key",
  isConfigured: () => true,
}));

// Dynamic import so the mock above is in effect.
let formatContextForPrompt: typeof import("../../src/memory/context.ts").formatContextForPrompt;

beforeAll(async () => {
  const mod = await import("../../src/memory/context.ts");
  formatContextForPrompt = mod.formatContextForPrompt;
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
    const out = formatContextForPrompt(null, {}, {});
    expect(out).toBe("");
  });

  it("renders a profile with only static facts (no memories) under a 'User Profile:' heading", () => {
    const profile = {
      profile: {
        static: ["Prefers concise responses", "Uses Bun"],
        dynamic: [],
      },
    } satisfies ProfileLike;
    const out = formatContextForPrompt(profile as unknown as Parameters<typeof formatContextForPrompt>[0], {}, {});
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
    const out = formatContextForPrompt(profile as unknown as Parameters<typeof formatContextForPrompt>[0], {}, {});
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
    const out = formatContextForPrompt(profile as unknown as Parameters<typeof formatContextForPrompt>[0], {}, {});
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
});
