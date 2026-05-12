import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// =====================================================================
// Background — what we are pinning
//
// `src/index.ts` exports `SupermemoryPlugin`, which returns an
// OpenCode plugin object with a `tool.supermemory` definition. Inside
// `tool.execute(args)` there is a `switch(mode)` that dispatches to
// one of five real-work branches (add/search/profile/list/forget) plus
// `help` and a default. Each branch:
//
//   1. validates args,
//   2. calls a method on the `supermemoryClient` singleton, and
//   3. wraps the result in a JSON envelope returned to the agent.
//
// These tests pin the JSON shapes returned for every branch + the
// pre-call validation / privacy / scope-defaulting behaviour. They are
// the "behavior contract" that the planned tool-mode refactor (T13)
// must preserve.
//
// Mocking strategy (informed by T6 notepad — "own-property shadow over
// prototype"):
//
//   - Mock the `supermemory` SDK module so the real SupermemoryClient
//     can instantiate without going to the network.
//   - Mock the config loader so `apiKey` is set and config has deterministic
//     values + explicit container-tag overrides
//     (avoids depending on `git config user.email`).
//   - Mock `src/shared/logger.ts` to a no-op so tests do not write
//     to `~/.opencode-supermemory.log`.
//   - After `SupermemoryPlugin(ctx)` returns, install per-test method
//     shadows on the `supermemoryClient` singleton instance. These
//     own-properties intercept calls before the prototype method runs.
//
// This avoids `mock.module("src/services/client.ts", ...)`, which
// leaks across files in parallel test mode (per T6 learnings).
// =====================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const LOGGER_ABS = join(REPO_ROOT, "src", "shared", "logger.ts");

// ---------------------------------------------------------------------
// SDK module mock — bare-minimum surface so `new Supermemory({apiKey})`
// + the eager `settings.update(...)` call inside getClient() do not
// blow up. We do NOT exercise this surface from the tests; method
// shadows on the singleton bypass it entirely.
// ---------------------------------------------------------------------
mock.module("supermemory", () => ({
  default: class MockSupermemorySDK {
    search = { memories: async () => ({ results: [], total: 0, timing: 0 }) };
    profile = async () => ({ profile: null });
    memories = {
      add: async () => ({ id: "sdk_unused" }),
      delete: async () => undefined,
      list: async () => ({ memories: [], pagination: { currentPage: 1, totalItems: 0, totalPages: 0 } }),
    };
    settings = {
      update: async () => undefined,
    };
  },
}));

// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Logger mock — avoid writing to ~/.opencode-supermemory.log during
// tests (the module-level appendFileSync call is the loud one).
// ---------------------------------------------------------------------
mock.module(LOGGER_ABS, () => ({
  initLogger: () => undefined,
  defaultLogger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
}));

// ---------------------------------------------------------------------
// Per-test state: mutable client behaviour + call tracking.
// ---------------------------------------------------------------------
interface ClientCall {
  args: unknown[];
}

const clientCalls: {
  addMemory: ClientCall[];
  searchMemories: ClientCall[];
  getProfile: ClientCall[];
  listMemories: ClientCall[];
  deleteMemory: ClientCall[];
} = {
  addMemory: [],
  searchMemories: [],
  getProfile: [],
  listMemories: [],
  deleteMemory: [],
};

const clientImpl: {
  addMemory: (content: string, tag: string, meta?: unknown) => unknown;
  searchMemories: (query: string, tag: string) => unknown;
  getProfile: (tag: string, query?: string) => unknown;
  listMemories: (tag: string, limit?: number) => unknown;
  deleteMemory: (id: string) => unknown;
} = {
  addMemory: () => ({ success: true, id: "mem_default" }),
  searchMemories: () => ({ success: true, results: [], total: 0, timing: 0 }),
  getProfile: () => ({ success: true, profile: { static: [], dynamic: [] } }),
  listMemories: () => ({ success: true, memories: [], pagination: { currentPage: 1, totalItems: 0, totalPages: 0 } }),
  deleteMemory: () => ({ success: true }),
};

let pluginInstance: Awaited<ReturnType<typeof import("../../src/index.ts").SupermemoryPlugin>>;
let toolDef: NonNullable<typeof pluginInstance.tool>["supermemory"];
let baselineToolDef: { description: string; args: Record<string, unknown> };
let MOCK_USER_TAG: string;
let MOCK_PROJECT_TAG: string;
let previousApiKey: string | undefined;

// Saved originals — used by afterAll to restore the singleton instance.
const savedOriginals: Record<string, unknown> = {};

beforeAll(async () => {
  // Dynamic imports so all mock.module() calls above are in effect.
  previousApiKey = process.env.SUPERMEMORY_API_KEY;
  process.env.SUPERMEMORY_API_KEY = "sm_test_key";
  const { SupermemoryPlugin } = await import("../../src/index.ts");
  const clientMod = await import("../../src/memory/client.ts");
  const tagsMod = await import("../../src/memory/tags.ts");
  const expectedTags = tagsMod.getTags("/test/project");
  MOCK_USER_TAG = expectedTags.user;
  MOCK_PROJECT_TAG = expectedTags.project;
  const singleton = clientMod.supermemoryClient as unknown as Record<string, unknown>;

  // Save prototype methods (if any own-properties already exist, save those instead).
  const methodNames = ["addMemory", "searchMemories", "getProfile", "listMemories", "deleteMemory"] as const;
  for (const name of methodNames) {
    savedOriginals[name] = Object.hasOwn(singleton, name) ? singleton[name] : undefined;
  }

  // Install own-property shadows. These intercept before the prototype methods run.
  Object.defineProperty(singleton, "addMemory", {
    value: async (content: string, tag: string, meta?: unknown) => {
      clientCalls.addMemory.push({ args: [content, tag, meta] });
      return clientImpl.addMemory(content, tag, meta);
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(singleton, "searchMemories", {
    value: async (query: string, tag: string) => {
      clientCalls.searchMemories.push({ args: [query, tag] });
      return clientImpl.searchMemories(query, tag);
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(singleton, "getProfile", {
    value: async (tag: string, query?: string) => {
      clientCalls.getProfile.push({ args: [tag, query] });
      return clientImpl.getProfile(tag, query);
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(singleton, "listMemories", {
    value: async (tag: string, limit?: number) => {
      clientCalls.listMemories.push({ args: [tag, limit] });
      return clientImpl.listMemories(tag, limit);
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(singleton, "deleteMemory", {
    value: async (id: string) => {
      clientCalls.deleteMemory.push({ args: [id] });
      return clientImpl.deleteMemory(id);
    },
    writable: true,
    configurable: true,
  });

  // Stub OpenCode plugin context. Only `directory` and `client.provider.list`
  // are touched during plugin init (the async IIFE that loads model limits).
  const ctx = {
    directory: "/test/project",
    project: { id: "p1", path: "/test/project" } as never,
    worktree: "/test/project",
    client: {
      provider: {
        list: async () => ({ data: { all: [] } }),
      },
    },
    $: {} as never,
  } as unknown as Parameters<typeof SupermemoryPlugin>[0];

  pluginInstance = await SupermemoryPlugin(ctx);
  const tools = pluginInstance.tool;
  if (!tools?.supermemory) {
    throw new Error("plugin.tool.supermemory not defined");
  }
  toolDef = tools.supermemory;

  baselineToolDef = JSON.parse(readFileSync(join(REPO_ROOT, "tests", "fixtures", "baseline", "tool-definition.json"), "utf-8"));
});

afterAll(async () => {
  // Restore singleton — remove own-property shadows so other test files in
  // parallel sibling runs see the prototype methods again.
  const clientMod = await import("../../src/memory/client.ts");
  const singleton = clientMod.supermemoryClient as unknown as Record<string, unknown>;
  for (const name of ["addMemory", "searchMemories", "getProfile", "listMemories", "deleteMemory"] as const) {
    const original = savedOriginals[name];
    if (original === undefined) {
      delete singleton[name];
    } else {
      Object.defineProperty(singleton, name, {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  }
  if (previousApiKey === undefined) delete process.env.SUPERMEMORY_API_KEY;
  else process.env.SUPERMEMORY_API_KEY = previousApiKey;
});

beforeEach(() => {
  clientCalls.addMemory.length = 0;
  clientCalls.searchMemories.length = 0;
  clientCalls.getProfile.length = 0;
  clientCalls.listMemories.length = 0;
  clientCalls.deleteMemory.length = 0;
  clientImpl.addMemory = () => ({ success: true, id: "mem_default" });
  clientImpl.searchMemories = () => ({ success: true, results: [], total: 0, timing: 0 });
  clientImpl.getProfile = () => ({ success: true, profile: { static: [], dynamic: [] } });
  clientImpl.listMemories = () => ({ success: true, memories: [], pagination: { currentPage: 1, totalItems: 0, totalPages: 0 } });
  clientImpl.deleteMemory = () => ({ success: true });
});

// Helper — invoke tool.execute with a stub ToolContext. The execute
// function ignores the second arg today, but we pass a real shape so
// any future tightening of the signature keeps these tests honest.
async function callTool(args: Record<string, unknown>): Promise<unknown> {
  const ctx = {
    sessionID: "ses_test",
    messageID: "msg_test",
    agent: "test",
    abort: new AbortController().signal,
  };
  // biome-ignore lint/suspicious/noExplicitAny: cross-zod-version arg typing
  const raw = await toolDef.execute(args as any, ctx);
  return JSON.parse(raw);
}

// =====================================================================
// Tool name + shape baseline
// =====================================================================

describe("tool registration", () => {
  it("registers exactly one tool named 'supermemory'", () => {
    const tools = pluginInstance.tool;
    if (!tools) throw new Error("plugin.tool missing");
    expect(Object.keys(tools)).toEqual(["supermemory"]);
  });

  it("tool description matches the captured baseline", () => {
    expect(toolDef.description).toBe(baselineToolDef.description);
  });

  it("tool args declare all six fields the baseline captured", () => {
    const baselineArgKeys = Object.keys(baselineToolDef.args).sort();
    const liveArgKeys = Object.keys(toolDef.args).sort();
    expect(liveArgKeys).toEqual(baselineArgKeys);
  });
});

// =====================================================================
// mode: add (happy + edges)
// =====================================================================

describe("tool.execute mode=add", () => {
  it("success: forwards content + project tag (default scope) + metadata.type to addMemory and returns id/scope/type envelope", async () => {
    clientImpl.addMemory = () => ({ success: true, id: "mem_added_1" });

    const out = (await callTool({
      mode: "add",
      content: "hello world",
      type: "preference",
    })) as { success: true; message: string; id: string; scope: string; type: string };

    expect(out.success).toBe(true);
    expect(out.id).toBe("mem_added_1");
    expect(out.scope).toBe("project");
    expect(out.type).toBe("preference");
    expect(out.message).toBe("Memory added to project scope");

    expect(clientCalls.addMemory).toHaveLength(1);
    // Note: content is passed through stripPrivateContent → unchanged here, plain text.
    expect(clientCalls.addMemory[0]?.args[0]).toBe("hello world");
    expect(clientCalls.addMemory[0]?.args[1]).toBe(MOCK_PROJECT_TAG);
    expect(clientCalls.addMemory[0]?.args[2]).toEqual({ type: "preference" });
  });

  it("scope=user routes to the user tag, scope=project routes to the project tag", async () => {
    clientImpl.addMemory = () => ({ success: true, id: "mem_scoped" });

    await callTool({ mode: "add", content: "u", scope: "user" });
    expect(clientCalls.addMemory[0]?.args[1]).toBe(MOCK_USER_TAG);

    await callTool({ mode: "add", content: "p", scope: "project" });
    expect(clientCalls.addMemory[1]?.args[1]).toBe(MOCK_PROJECT_TAG);
  });

  it("validation: missing content returns { success:false, error } and does NOT call addMemory", async () => {
    const out = (await callTool({ mode: "add" })) as { success: false; error: string };

    expect(out).toEqual({
      success: false,
      error: "content parameter is required for add mode",
    });
    expect(clientCalls.addMemory).toHaveLength(0);
  });

  it("privacy: fully-private content blocks the addMemory call and surfaces a privacy error", async () => {
    const out = (await callTool({
      mode: "add",
      content: "<private>sk-abc123</private>",
    })) as { success: false; error: string };

    expect(out).toEqual({
      success: false,
      error: "Cannot store fully private content",
    });
    expect(clientCalls.addMemory).toHaveLength(0);
  });

  it("privacy: mixed content has private spans replaced with [REDACTED] before reaching addMemory", async () => {
    clientImpl.addMemory = () => ({ success: true, id: "mem_redact" });

    await callTool({
      mode: "add",
      content: "key: <private>sk-abc</private> rest",
    });

    expect(clientCalls.addMemory).toHaveLength(1);
    expect(clientCalls.addMemory[0]?.args[0]).toBe("key: [REDACTED] rest");
  });

  it("client failure: addMemory error envelope is forwarded to the agent verbatim", async () => {
    clientImpl.addMemory = () => ({ success: false, error: "rate limited" });

    const out = (await callTool({ mode: "add", content: "hi" })) as { success: false; error: string };
    expect(out).toEqual({ success: false, error: "rate limited" });
  });
});

// =====================================================================
// mode: search (happy + edges)
// =====================================================================

describe("tool.execute mode=search", () => {
  it("scope=user: forwards query+user tag to searchMemories and shapes results as {id,content,similarity,scope?}", async () => {
    clientImpl.searchMemories = () => ({
      success: true,
      results: [
        { id: "m1", memory: "remember A", similarity: 0.9 },
        { id: "m2", chunk: "fragment B", similarity: 0.7 },
      ],
      total: 2,
      timing: 12,
    });

    const out = (await callTool({ mode: "search", query: "test", scope: "user" })) as {
      success: true;
      query: string;
      scope: string;
      count: number;
      results: Array<{ id: string; content: string; similarity: number }>;
    };

    expect(out.success).toBe(true);
    expect(out.query).toBe("test");
    expect(out.scope).toBe("user");
    expect(out.count).toBe(2);
    expect(out.results).toEqual([
      { id: "m1", content: "remember A", similarity: 90 },
      { id: "m2", content: "fragment B", similarity: 70 },
    ]);

    expect(clientCalls.searchMemories).toHaveLength(1);
    expect(clientCalls.searchMemories[0]?.args).toEqual(["test", MOCK_USER_TAG]);
  });

  it("scope=project: routes through the project tag", async () => {
    clientImpl.searchMemories = () => ({ success: true, results: [], total: 0, timing: 0 });

    const out = (await callTool({ mode: "search", query: "x", scope: "project" })) as { scope: string };
    expect(out.scope).toBe("project");
    expect(clientCalls.searchMemories[0]?.args).toEqual(["x", MOCK_PROJECT_TAG]);
  });

  it("unset scope: searches BOTH tags and returns a merged sorted result set tagged per-row with scope", async () => {
    let call = 0;
    clientImpl.searchMemories = () => {
      call += 1;
      // first call (tags.user) → low similarity; second (tags.project) → high similarity.
      if (call === 1) {
        return {
          success: true,
          results: [{ id: "u1", memory: "user fact", similarity: 0.5 }],
          total: 1,
          timing: 0,
        };
      }
      return {
        success: true,
        results: [{ id: "p1", memory: "project fact", similarity: 0.95 }],
        total: 1,
        timing: 0,
      };
    };

    const out = (await callTool({ mode: "search", query: "anything" })) as {
      success: true;
      count: number;
      results: Array<{ id: string; content: string; similarity: number; scope: string }>;
    };

    // Both tags consulted in parallel — order of calls follows Promise.all execution.
    expect(clientCalls.searchMemories).toHaveLength(2);
    expect(clientCalls.searchMemories.map((c) => c.args[1])).toEqual([MOCK_USER_TAG, MOCK_PROJECT_TAG]);

    expect(out.count).toBe(2);
    // Sorted descending by similarity, scope tagged per-row.
    expect(out.results[0]).toEqual({ id: "p1", content: "project fact", similarity: 95, scope: "project" });
    expect(out.results[1]).toEqual({ id: "u1", content: "user fact", similarity: 50, scope: "user" });
  });

  it("validation: missing query returns { success:false, error } and does NOT call searchMemories", async () => {
    const out = (await callTool({ mode: "search" })) as { success: false; error: string };

    expect(out).toEqual({
      success: false,
      error: "query parameter is required for search mode",
    });
    expect(clientCalls.searchMemories).toHaveLength(0);
  });

  it("client failure on scoped search: error envelope is forwarded", async () => {
    clientImpl.searchMemories = () => ({ success: false, error: "503 unavailable", results: [], total: 0, timing: 0 });

    const out = (await callTool({ mode: "search", query: "q", scope: "user" })) as { success: false; error: string };
    expect(out).toEqual({ success: false, error: "503 unavailable" });
  });
});

// =====================================================================
// mode: profile (happy + edges)
// =====================================================================

describe("tool.execute mode=profile", () => {
  it("success: routes to getProfile(user-tag, query?) and returns { profile: { static, dynamic } }", async () => {
    clientImpl.getProfile = () => ({
      success: true,
      profile: { static: ["loves typescript"], dynamic: ["currently debugging X"] },
    });

    const out = (await callTool({ mode: "profile", query: "preferences" })) as {
      success: true;
      profile: { static: string[]; dynamic: string[] };
    };

    expect(out).toEqual({
      success: true,
      profile: { static: ["loves typescript"], dynamic: ["currently debugging X"] },
    });
    expect(clientCalls.getProfile).toHaveLength(1);
    expect(clientCalls.getProfile[0]?.args).toEqual([MOCK_USER_TAG, "preferences"]);
  });

  it("query omitted: getProfile receives undefined query and still returns the profile envelope", async () => {
    clientImpl.getProfile = () => ({ success: true, profile: { static: [], dynamic: [] } });

    await callTool({ mode: "profile" });

    expect(clientCalls.getProfile[0]?.args).toEqual([MOCK_USER_TAG, undefined]);
  });

  it("profile missing on success: empty arrays are substituted for missing static/dynamic slots", async () => {
    // T13 may unify this — pin the current "lenient defaulting" behaviour.
    clientImpl.getProfile = () => ({ success: true });

    const out = (await callTool({ mode: "profile" })) as { profile: { static: unknown[]; dynamic: unknown[] } };
    expect(out.profile).toEqual({ static: [], dynamic: [] });
  });

  it("client failure: error envelope is forwarded", async () => {
    clientImpl.getProfile = () => ({ success: false, error: "401 unauthorized", profile: null });

    const out = (await callTool({ mode: "profile" })) as { success: false; error: string };
    expect(out).toEqual({ success: false, error: "401 unauthorized" });
  });
});

// =====================================================================
// mode: list (happy + edges)
// =====================================================================

describe("tool.execute mode=list", () => {
  it("success: default scope=project, default limit=20; returns shaped memories array", async () => {
    clientImpl.listMemories = () => ({
      success: true,
      memories: [{ id: "m1", summary: "summary A", createdAt: "2026-01-01", metadata: { type: "preference" } }],
      pagination: { currentPage: 1, totalItems: 1, totalPages: 1 },
    });

    const out = (await callTool({ mode: "list" })) as {
      success: true;
      scope: string;
      count: number;
      memories: Array<{ id: string; content: string; createdAt: string; metadata: { type: string } }>;
    };

    expect(out.success).toBe(true);
    expect(out.scope).toBe("project");
    expect(out.count).toBe(1);
    expect(out.memories[0]).toEqual({
      id: "m1",
      content: "summary A",
      createdAt: "2026-01-01",
      metadata: { type: "preference" },
    });

    expect(clientCalls.listMemories).toHaveLength(1);
    expect(clientCalls.listMemories[0]?.args).toEqual([MOCK_PROJECT_TAG, 20]);
  });

  it("scope=user + custom limit: routes to user tag and forwards limit verbatim", async () => {
    clientImpl.listMemories = () => ({
      success: true,
      memories: [],
      pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
    });

    await callTool({ mode: "list", scope: "user", limit: 5 });
    expect(clientCalls.listMemories[0]?.args).toEqual([MOCK_USER_TAG, 5]);
  });

  it("client failure: error envelope is forwarded", async () => {
    clientImpl.listMemories = () => ({
      success: false,
      error: "boom",
      memories: [],
      pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
    });

    const out = (await callTool({ mode: "list" })) as { success: false; error: string };
    expect(out).toEqual({ success: false, error: "boom" });
  });
});

// =====================================================================
// mode: forget (happy + edges)
// =====================================================================

describe("tool.execute mode=forget", () => {
  it("success: deleteMemory called with id; envelope reports the scope that the agent specified", async () => {
    clientImpl.deleteMemory = () => ({ success: true });

    const out = (await callTool({ mode: "forget", memoryId: "mem_xyz", scope: "user" })) as {
      success: true;
      message: string;
    };

    expect(out).toEqual({
      success: true,
      message: "Memory mem_xyz removed from user scope",
    });
    expect(clientCalls.deleteMemory).toHaveLength(1);
    expect(clientCalls.deleteMemory[0]?.args).toEqual(["mem_xyz"]);
  });

  it("default scope: when scope is omitted, envelope reports 'project' as the scope removed-from", async () => {
    clientImpl.deleteMemory = () => ({ success: true });

    const out = (await callTool({ mode: "forget", memoryId: "mem_default_scope" })) as {
      success: true;
      message: string;
    };
    expect(out.message).toBe("Memory mem_default_scope removed from project scope");
  });

  it("validation: missing memoryId returns { success:false, error } and does NOT call deleteMemory", async () => {
    const out = (await callTool({ mode: "forget" })) as { success: false; error: string };

    expect(out).toEqual({
      success: false,
      error: "memoryId parameter is required for forget mode",
    });
    expect(clientCalls.deleteMemory).toHaveLength(0);
  });

  it("client failure: error envelope is forwarded", async () => {
    clientImpl.deleteMemory = () => ({ success: false, error: "not found" });

    const out = (await callTool({ mode: "forget", memoryId: "mem_404" })) as { success: false; error: string };
    expect(out).toEqual({ success: false, error: "not found" });
  });
});

// =====================================================================
// fallthrough modes — pin the help / unknown-mode behaviour so an
// accidental rename or removal trips a test.
// =====================================================================

describe("tool.execute fallthrough modes", () => {
  it("mode=help (default when omitted): returns the usage guide envelope WITHOUT calling the client", async () => {
    const out = (await callTool({})) as {
      success: true;
      message: string;
      commands: Array<{ command: string }>;
      scopes: Record<string, string>;
      types: string[];
    };

    expect(out.success).toBe(true);
    expect(out.message).toBe("Supermemory Usage Guide");
    expect(out.commands.map((c) => c.command)).toEqual(["add", "search", "profile", "list", "forget"]);
    expect(out.scopes.user).toMatch(/cross-project/i);
    expect(out.scopes.project).toMatch(/project-specific/i);
    expect(out.types).toContain("preference");
    expect(out.types).toContain("conversation");

    expect(clientCalls.addMemory).toHaveLength(0);
    expect(clientCalls.searchMemories).toHaveLength(0);
    expect(clientCalls.getProfile).toHaveLength(0);
    expect(clientCalls.listMemories).toHaveLength(0);
    expect(clientCalls.deleteMemory).toHaveLength(0);
  });

  it("client throws unexpectedly: outer catch returns { success:false, error } with the thrown message", async () => {
    clientImpl.addMemory = () => {
      throw new Error("synchronous boom");
    };

    const out = (await callTool({ mode: "add", content: "x" })) as { success: false; error: string };
    expect(out).toEqual({ success: false, error: "synchronous boom" });
  });
});
