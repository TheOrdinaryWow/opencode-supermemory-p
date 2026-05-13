import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

import type { AppError } from "@/shared/errors";
import type { DedupCache } from "@/memory/dedup";

// =====================================================================
// Background — what we are pinning
//
// `src/memory/client.ts` implements the memory client. The
// production implementation returns Result<T, AppError> for expected
// SDK/config/network/auth failures while preserving the SDK call shapes.
//
// We avoid the HTTP layer entirely by mocking the `supermemory` module
// itself via `mock.module`. The mock exposes a class whose method
// surface matches the SDK shape consumed by client.ts:
//   - client.search.memories(opts)   →   { results, total, timing, ... }
//   - client.profile(opts)           →   { profile, ... }
//   - client.memories.add(opts)      →   { id, ... }
//   - client.memories.delete(id)     →   any
//   - client.memories.list(opts)     →   { memories, pagination, ... }
//   - client.settings.update(opts)   →   any (fire-and-forget)
//
// `formatConversationMessage` / `formatConversationTranscript` are
// private — they're observed indirectly via the `content` argument
// passed to `memories.add` from inside `ingestConversation`.
// =====================================================================

// Mutable per-test SDK behavior. Tests assign onto this before calling
// the client; the mocked Supermemory class reads from it on every call.
interface SdkCall {
  args: unknown[];
}
const sdkState: {
  searchMemories: { calls: SdkCall[]; impl?: (opts: unknown) => unknown };
  profile: { calls: SdkCall[]; impl?: (opts: unknown) => unknown };
  addMemory: { calls: SdkCall[]; impl?: (opts: unknown) => unknown };
  deleteMemory: { calls: SdkCall[]; impl?: (id: string) => unknown };
  listMemories: { calls: SdkCall[]; impl?: (opts: unknown) => unknown };
  settingsUpdate: { calls: SdkCall[]; impl?: (opts: unknown) => unknown };
} = {
  searchMemories: { calls: [] },
  profile: { calls: [] },
  addMemory: { calls: [] },
  deleteMemory: { calls: [] },
  listMemories: { calls: [] },
  settingsUpdate: { calls: [] },
};

const timeoutState: {
  calls: Array<{ ms: number; label?: string }>;
  rejectLabels: Set<string>;
} = {
  calls: [],
  rejectLabels: new Set(),
};

mock.module("@/shared/timeout", () => ({
  withTimeout: <T>(promise: Promise<T>, ms: number, label?: string): Promise<T> => {
    timeoutState.calls.push({ ms, label });
    if (label && timeoutState.rejectLabels.has(label)) {
      return Promise.reject(new Error(`Timeout after ${ms}ms (${label})`));
    }
    return promise;
  },
}));

// Mock the `supermemory` SDK module. Returns a class whose constructor
// shape matches `new Supermemory({ apiKey })` and exposes the same
// method tree client.ts navigates into.
mock.module("supermemory", () => {
  return {
    default: class MockSupermemory {
      search = {
        memories: async (opts: unknown) => {
          sdkState.searchMemories.calls.push({ args: [opts] });
          const impl = sdkState.searchMemories.impl ?? (() => ({ results: [], total: 0, timing: 0 }));
          return impl(opts);
        },
      };
      profile = async (opts: unknown) => {
        sdkState.profile.calls.push({ args: [opts] });
        const impl = sdkState.profile.impl ?? (() => ({ profile: null }));
        return impl(opts);
      };
      memories = {
        add: async (opts: unknown) => {
          sdkState.addMemory.calls.push({ args: [opts] });
          const impl = sdkState.addMemory.impl ?? (() => ({ id: "mem_default" }));
          return impl(opts);
        },
        delete: async (id: string) => {
          sdkState.deleteMemory.calls.push({ args: [id] });
          const impl = sdkState.deleteMemory.impl ?? (() => undefined);
          return impl(id);
        },
        list: async (opts: unknown) => {
          sdkState.listMemories.calls.push({ args: [opts] });
          const impl =
            sdkState.listMemories.impl ?? (() => ({ memories: [], pagination: { currentPage: 1, totalItems: 0, totalPages: 0 } }));
          return impl(opts);
        },
      };
      settings = {
        update: async (opts: unknown) => {
          sdkState.settingsUpdate.calls.push({ args: [opts] });
          const impl = sdkState.settingsUpdate.impl ?? (() => undefined);
          return impl(opts);
        },
      };
    },
  };
});

// Dynamic import so both mocks are in effect before client.ts loads.
let SupermemoryClient: typeof import("@/memory/client").SupermemoryClient;
let getConfig: typeof import("@/config/loader").getConfig;
let resetConfigCache: typeof import("@/config/loader").resetConfigCache;
let previousApiKey: string | undefined;

function expectErrorKind(error: AppError, kind: AppError["kind"], message: string): void {
  expect(error.kind).toBe(kind);
  expect(error.message).toBe(message);
}

beforeAll(async () => {
  previousApiKey = process.env.SUPERMEMORY_API_KEY;
  process.env.SUPERMEMORY_API_KEY = "sm_test_key";
  // Bust any cached config left over from other test files (e.g. tags.test.ts
  // calls getConfig() without an apiKey set) so getClient() picks up the env
  // we just set instead of returning a poisoned singleton.
  ({ getConfig, resetConfigCache } = await import("@/config/loader"));
  resetConfigCache();
  const mod = await import("@/memory/client");
  SupermemoryClient = mod.SupermemoryClient;
});

afterAll(() => {
  if (previousApiKey === undefined) delete process.env.SUPERMEMORY_API_KEY;
  else process.env.SUPERMEMORY_API_KEY = previousApiKey;
});

function resetSdkState(): void {
  sdkState.searchMemories.calls.length = 0;
  sdkState.searchMemories.impl = undefined;
  sdkState.profile.calls.length = 0;
  sdkState.profile.impl = undefined;
  sdkState.addMemory.calls.length = 0;
  sdkState.addMemory.impl = undefined;
  sdkState.deleteMemory.calls.length = 0;
  sdkState.deleteMemory.impl = undefined;
  sdkState.listMemories.calls.length = 0;
  sdkState.listMemories.impl = undefined;
  sdkState.settingsUpdate.calls.length = 0;
  sdkState.settingsUpdate.impl = undefined;
}

function resetTimeoutState(): void {
  timeoutState.calls.length = 0;
  timeoutState.rejectLabels.clear();
}

beforeEach(() => {
  resetConfigCache();
  const config = getConfig();
  config.dedupEnabled = false;
  config.autoCategoryTagging = false;
  resetSdkState();
  resetTimeoutState();
});

// =====================================================================
// searchMemories — 2 paths (success / error)
// =====================================================================

describe("SupermemoryClient.searchMemories", () => {
  it("success: returns { success: true, ...sdkResult } and forwards config into the SDK call", async () => {
    sdkState.searchMemories.impl = () => ({
      results: [{ id: "mem_1", content: "hello", similarity: 0.9 }],
      total: 1,
      timing: 12,
    });
    const client = new SupermemoryClient();
    const out = await client.searchMemories("q", "tag_a");

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok result");
    expect(out.value.results as unknown[]).toEqual([{ id: "mem_1", content: "hello", similarity: 0.9 }]);
    expect(out.value.total).toBe(1);
    expect(out.value.timing).toBe(12);

    // SDK call shape pinned: searchMode "hybrid", threshold/limit from config.
    expect(sdkState.searchMemories.calls).toHaveLength(1);
    expect(sdkState.searchMemories.calls[0]?.args[0]).toEqual({
      q: "q",
      containerTag: "tag_a",
      threshold: 0.6,
      limit: 5,
      searchMode: "hybrid",
    });
  });

  it("error: timeout failure includes the shared timeout label", async () => {
    timeoutState.rejectLabels.add("supermemory.searchMemories");
    const client = new SupermemoryClient();
    const out = await client.searchMemories("q", "tag_a");

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected error result");
    expectErrorKind(out.error, "NetworkError", "Timeout after 5000ms (supermemory.searchMemories)");
    expect(timeoutState.calls[0]).toEqual({ ms: 5000, label: "supermemory.searchMemories" });
  });

  it("error: SDK throw → returns { success: false, error, results: [], total: 0, timing: 0 } envelope", async () => {
    sdkState.searchMemories.impl = () => {
      throw new Error("boom: 503 service unavailable");
    };
    const client = new SupermemoryClient();
    const out = await client.searchMemories("q", "tag_a");

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected error result");
    expectErrorKind(out.error, "NetworkError", "boom: 503 service unavailable");
  });
});

// =====================================================================
// getProfile — 2 paths (success / error)
// =====================================================================

describe("SupermemoryClient.getProfile", () => {
  it("success: returns { success: true, ...sdkResult } and forwards query into the SDK", async () => {
    sdkState.profile.impl = () => ({ profile: { static: ["a"], dynamic: ["b"] } });
    const client = new SupermemoryClient();
    const out = await client.getProfile("tag_user", "search?");

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok result");
    expect(out.value.profile).toEqual({ static: ["a"], dynamic: ["b"] });
    expect(sdkState.profile.calls[0]?.args[0]).toEqual({ containerTag: "tag_user", q: "search?" });
  });

  it("error: SDK throw → returns { success: false, error, profile: null } (note: distinct fallback shape from searchMemories)", async () => {
    sdkState.profile.impl = () => {
      throw new Error("401 unauthorized");
    };
    const client = new SupermemoryClient();
    const out = await client.getProfile("tag_user");

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected error result");
    expectErrorKind(out.error, "AuthError", "401 unauthorized");
  });
});

// =====================================================================
// addMemory — 2 paths (success / error)
// =====================================================================

describe("SupermemoryClient.addMemory", () => {
  it("success: returns { success: true, id, ... } and forwards content + metadata to the SDK", async () => {
    sdkState.addMemory.impl = () => ({ id: "mem_new_123", status: "stored" });
    const client = new SupermemoryClient();
    const out = await client.addMemory("hello world", "tag_p", { type: "preference", tool: "test" });

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok result");
    expect(out.value.id).toBe("mem_new_123");

    expect(sdkState.addMemory.calls[0]?.args[0]).toEqual({
      content: "hello world",
      containerTag: "tag_p",
      metadata: { type: "preference", tool: "test", entityContext: expect.any(String) },
    });
  });

  it("success: dedup cache intercepts duplicate content before the SDK call", async () => {
    const config = getConfig();
    config.dedupEnabled = true;
    const dedupCache: DedupCache = {
      has: mock((content: string) => content === "duplicate memory"),
      add: mock(() => undefined),
      flush: mock(async () => undefined),
      load: mock(async () => undefined),
    };
    const client = new SupermemoryClient({ dedupCache });
    const out = await client.addMemory("duplicate memory", "tag_p");

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok result");
    expect(out.value).toEqual({ success: true, deduped: true });
    expect(sdkState.addMemory.calls).toHaveLength(0);
    expect(dedupCache.add).toHaveBeenCalledTimes(0);
  });

  it("success: entity context is clamped into metadata before adding memory", async () => {
    const config = getConfig();
    config.entityContext = "entity ".repeat(400);
    sdkState.addMemory.impl = () => ({ id: "mem_entity" });
    const client = new SupermemoryClient();
    await client.addMemory("remember my company is Acme", "tag_p", { tool: "test" });

    const addCall = sdkState.addMemory.calls[0]?.args[0] as { metadata: Record<string, unknown> };
    expect(typeof addCall.metadata.entityContext).toBe("string");
    expect((addCall.metadata.entityContext as string).length).toBeLessThanOrEqual(1500);
    expect(addCall.metadata.entityContext).not.toBe(config.entityContext);
  });

  it("success: category is detected when auto tagging is enabled and metadata has no type", async () => {
    const config = getConfig();
    config.autoCategoryTagging = true;
    sdkState.addMemory.impl = () => ({ id: "mem_category" });
    const client = new SupermemoryClient();
    await client.addMemory("I prefer Bun for project scripts", "tag_p", { tool: "test" });

    const addCall = sdkState.addMemory.calls[0]?.args[0] as { metadata: Record<string, unknown> };
    expect(addCall.metadata.type).toBe("preference");
  });

  it("error: SDK throw → returns { success: false, error } (minimal shape — no fallback `id`)", async () => {
    sdkState.addMemory.impl = () => {
      throw new Error("rate limited");
    };
    const client = new SupermemoryClient();
    const out = await client.addMemory("x", "tag_p");

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected error result");
    expectErrorKind(out.error, "NetworkError", "rate limited");
  });
});

// =====================================================================
// deleteMemory — 2 paths (success / error)
// =====================================================================

describe("SupermemoryClient.deleteMemory", () => {
  it("success: returns { success: true } (no spread of SDK result — distinct shape)", async () => {
    sdkState.deleteMemory.impl = () => ({ acknowledged: true });
    const client = new SupermemoryClient();
    const out = await client.deleteMemory("mem_abc");

    expect(out).toEqual({ ok: true, value: { success: true } });
    expect(sdkState.deleteMemory.calls[0]?.args[0]).toBe("mem_abc");
  });

  it("error: SDK throw → returns { success: false, error }", async () => {
    sdkState.deleteMemory.impl = () => {
      throw new Error("not found");
    };
    const client = new SupermemoryClient();
    const out = await client.deleteMemory("mem_abc");

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected error result");
    expectErrorKind(out.error, "NetworkError", "not found");
  });
});

// =====================================================================
// listMemories — 2 paths (success / error)
// =====================================================================

describe("SupermemoryClient.listMemories", () => {
  it("success: returns { success: true, memories, pagination } and uses default limit=20", async () => {
    sdkState.listMemories.impl = () => ({
      memories: [{ id: "m1", content: "c1" }],
      pagination: { currentPage: 1, totalItems: 1, totalPages: 1 },
    });
    const client = new SupermemoryClient();
    const out = await client.listMemories("tag_p");

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok result");
    expect(out.value.memories as unknown[]).toEqual([{ id: "m1", content: "c1" }]);

    // SDK options pinned (note: containerTags is an ARRAY here, not a string).
    expect(sdkState.listMemories.calls[0]?.args[0]).toEqual({
      containerTags: ["tag_p"],
      limit: 20,
      order: "desc",
      sort: "createdAt",
      includeContent: true,
    });
  });

  it("error: SDK throw → returns { success: false, error, memories: [], pagination: { currentPage: 1, totalItems: 0, totalPages: 0 } }", async () => {
    sdkState.listMemories.impl = () => {
      throw new Error("oops");
    };
    const client = new SupermemoryClient();
    const out = await client.listMemories("tag_p", 50);

    // Custom limit also forwarded.
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected error result");
    expectErrorKind(out.error, "NetworkError", "oops");
  });
});

// =====================================================================
// ingestConversation — composite method, exercises BOTH private
// formatters (formatConversationMessage / formatConversationTranscript)
// through the `content` argument captured on each addMemory call.
// =====================================================================

describe("SupermemoryClient.ingestConversation", () => {
  it("error: empty messages array short-circuits with { success: false, error: 'No messages to ingest' } before any addMemory call", async () => {
    const client = new SupermemoryClient();
    const out = await client.ingestConversation("conv_1", [], ["tag_a"]);

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected error result");
    expectErrorKind(out.error, "ValidationError", "No messages to ingest");
    expect(sdkState.addMemory.calls).toHaveLength(0);
  });

  it("error: containerTags collapsing to empty (after dedup + length filter) returns { success: false, error: 'At least one containerTag is required' }", async () => {
    const client = new SupermemoryClient();
    // Both entries collapse to empty after the `tag.length > 0` filter on line 160.
    const out = await client.ingestConversation("conv_1", [{ role: "user", content: "hi" }], ["", ""]);

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected error result");
    expectErrorKind(out.error, "ValidationError", "At least one containerTag is required");
    expect(sdkState.addMemory.calls).toHaveLength(0);
  });

  it("success: single tag, string content — locks the transcript prefix format `[Conversation <id>]\\n1. [role] <text>`", async () => {
    sdkState.addMemory.impl = () => ({ id: "mem_stored_1" });
    const client = new SupermemoryClient();
    const out = await client.ingestConversation(
      "conv_42",
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ],
      ["tag_p"],
    );

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok result");
    expect(out.value.status).toBe("stored");
    expect(out.value.storedMemoryIds).toEqual(["mem_stored_1"]);

    // Verify the formatted content reaches addMemory.
    const addCall = sdkState.addMemory.calls[0]?.args[0] as { content: string };
    expect(addCall.content).toMatchInlineSnapshot(`
"[Conversation conv_42]
1. [user] hello
2. [assistant] hi there"
`);
  });

  it("success: array content with text parts is concatenated with `\\n` and prefixed by `[role]`", async () => {
    sdkState.addMemory.impl = () => ({ id: "mem_arr_1" });
    const client = new SupermemoryClient();
    await client.ingestConversation(
      "conv_arr",
      [
        {
          role: "user",
          content: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        },
      ],
      ["tag_p"],
    );

    const addCall = sdkState.addMemory.calls[0]?.args[0] as { content: string };
    // `\n` between parts inside the SAME message, then trimmed.
    expect(addCall.content).toMatchInlineSnapshot(`
"[Conversation conv_arr]
1. [user] first
second"
`);
  });

  it("success: image part is formatted as `[image] <url>` and joined with sibling text parts", async () => {
    sdkState.addMemory.impl = () => ({ id: "mem_img_1" });
    const client = new SupermemoryClient();
    await client.ingestConversation(
      "conv_img",
      [
        {
          role: "user",
          content: [
            { type: "text", text: "look at this" },
            { type: "image_url", imageUrl: { url: "https://example.com/cat.png" } },
          ],
        },
      ],
      ["tag_p"],
    );

    const addCall = sdkState.addMemory.calls[0]?.args[0] as { content: string };
    expect(addCall.content).toMatchInlineSnapshot(`
"[Conversation conv_img]
1. [user] look at this
[image] https://example.com/cat.png"
`);
  });

  it("success: whitespace-only string content renders bare `[role]` with NO trailing space (trimmed empty branch on line 25)", async () => {
    sdkState.addMemory.impl = () => ({ id: "mem_blank_1" });
    const client = new SupermemoryClient();
    await client.ingestConversation("conv_blank", [{ role: "system", content: "   \n  " }], ["tag_p"]);

    const addCall = sdkState.addMemory.calls[0]?.args[0] as { content: string };
    expect(addCall.content).toMatchInlineSnapshot(`
"[Conversation conv_blank]
1. [system]"
`);
  });

  it("success: multi-tag — addMemory is called once per UNIQUE tag and ingestMetadata.originalContainerTags reflects the deduped set", async () => {
    sdkState.addMemory.impl = () => ({ id: "mem_multi_1" });
    const client = new SupermemoryClient();
    const out = await client.ingestConversation(
      "conv_m",
      [{ role: "user", content: "x" }],
      // duplicate "tag_a" should collapse to one call.
      ["tag_a", "tag_b", "tag_a"],
    );

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok result");
    expect(out.value.status).toBe("stored");
    expect(sdkState.addMemory.calls).toHaveLength(2);

    const firstCall = sdkState.addMemory.calls[0]?.args[0] as { containerTag: string; metadata: Record<string, unknown> };
    expect(firstCall.containerTag).toBe("tag_a");
    // metadata.originalContainerTags is the DEDUPED list — order from Set iteration.
    expect(firstCall.metadata.originalContainerTags).toEqual(["tag_a", "tag_b"]);
    expect(firstCall.metadata.type).toBe("conversation");
    expect(firstCall.metadata.conversationId).toBe("conv_m");
    expect(firstCall.metadata.messageCount).toBe(1);
  });

  it("success: when some tags succeed and some fail, status becomes 'partial' and storedMemoryIds only contains successful ids", async () => {
    let call = 0;
    sdkState.addMemory.impl = () => {
      call += 1;
      if (call === 1) return { id: "mem_ok" };
      if (call === 2) throw new Error("temporary failure");
      return { id: "mem_ok_3" };
    };
    const client = new SupermemoryClient();
    const out = await client.ingestConversation("conv_p", [{ role: "user", content: "x" }], ["tag_a", "tag_b", "tag_c"]);

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok result");
    expect(out.value.status).toBe("partial");
    expect(out.value.storedMemoryIds).toEqual(["mem_ok", "mem_ok_3"]);
  });

  it("error: when EVERY tag fails, returns { success: false, error: <first error> } (no successful id is reported)", async () => {
    sdkState.addMemory.impl = () => {
      throw new Error("all fail");
    };
    const client = new SupermemoryClient();
    const out = await client.ingestConversation("conv_f", [{ role: "user", content: "x" }], ["tag_a", "tag_b"]);

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected error result");
    expectErrorKind(out.error, "NetworkError", "all fail");
  });

  it("success: oversized transcript is truncated to MAX_CONVERSATION_CHARS (100_000) with `\\n...[truncated]` suffix", async () => {
    sdkState.addMemory.impl = () => ({ id: "mem_trunc_1" });
    const client = new SupermemoryClient();
    // 60k chars of message content → header + transcript exceeds 100k.
    const bigText = "a".repeat(60_000);
    await client.ingestConversation(
      "conv_big",
      [
        { role: "user", content: bigText },
        { role: "assistant", content: bigText },
      ],
      ["tag_p"],
    );

    const addCall = sdkState.addMemory.calls[0]?.args[0] as { content: string };
    // Truncation suffix is `\n...[truncated]` (15 chars) after slice(0, 100_000).
    expect(addCall.content.length).toBe(100_000 + "\n...[truncated]".length);
    expect(addCall.content.endsWith("\n...[truncated]")).toBe(true);
  });

  it("success: extra metadata supplied by caller is merged into ingestMetadata (custom keys preserved)", async () => {
    sdkState.addMemory.impl = () => ({ id: "mem_meta_1" });
    const client = new SupermemoryClient();
    await client.ingestConversation("conv_meta", [{ role: "user", content: "x" }], ["tag_p"], {
      customA: "v1",
      customB: 42,
      customC: true,
    });

    const addCall = sdkState.addMemory.calls[0]?.args[0] as { metadata: Record<string, unknown> };
    expect(addCall.metadata.customA).toBe("v1");
    expect(addCall.metadata.customB).toBe(42);
    expect(addCall.metadata.customC).toBe(true);
    // Built-in metadata keys still present.
    expect(addCall.metadata.type).toBe("conversation");
    expect(addCall.metadata.conversationId).toBe("conv_meta");
  });
});
