import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir";

// =====================================================================
// Background — what we are pinning
//
// `src/services/compaction.ts` triggers OpenCode's session summarization
// when the assistant's token usage crosses a configurable threshold
// (default 0.8 of the context limit). The decision is made inside
// `checkAndTriggerCompaction`, which is NOT exported — so we drive it
// through the exposed `createCompactionHook(ctx, tags, opts)` factory
// and feed `message.updated` events to the returned `event` handler.
//
// The constants under test (compaction.ts lines 12-15):
//   DEFAULT_THRESHOLD            = 0.8
//   MIN_TOKENS_FOR_COMPACTION    = 50_000
//   COMPACTION_COOLDOWN_MS       = 30_000
//   DEFAULT_CONTEXT_LIMIT        = 200_000
//
// Trigger decision flow (compaction.ts:315-356):
//   1. compactionInProgress[sessionID] set?       → skip
//   2. now - lastCompactionTime < cooldown?       → skip   ← (4) cooldown test
//   3. lastAssistant.summary === true?            → skip   ← (7) summary skip
//   4. !lastAssistant.tokens?                     → skip   ← (8) no-tokens skip
//   5. totalUsed < MIN_TOKENS_FOR_COMPACTION?     → skip   ← (5) min-tokens test
//   6. usageRatio < threshold?                    → skip   ← (1) below-threshold
//   7. ALL pass → call ctx.client.session.summarize        ← (2)(3)(6) trigger
//
// Side effects we have to tame:
//   - `MESSAGE_STORAGE = join(homedir(), '.opencode', 'messages')` is
//     evaluated at module-load time → set HOME to a tmpdir BEFORE the
//     dynamic import.
//   - `injectCompactionContext` calls `supermemoryClient.listMemories`
//     and writes files via `injectHookMessage` → we mutate the
//     singleton's methods directly (after import) rather than using
//     mock.module on src/services/client.ts. Reason: mock.module is
//     process-global per inherited wisdom in
//     .sisyphus/notepads/architecture-refactor/learnings.md L134-137,
//     and replacing the whole client.ts module in this file leaks an
//     empty SupermemoryClient class into tests/unit/client.test.ts when
//     bun parallelises files. Direct mutation of the singleton instance
//     is local to its prototype chain and does not affect callers that
//     construct fresh SupermemoryClient instances (which is what
//     client.test.ts does).
// =====================================================================

// Note: we intentionally use the real config loader here.
// It loads with whatever HOME we set below — since no JSONC file
// exists under that tmpdir, the real config falls through to DEFAULTS,
// which is deterministic for our purposes.
// Dynamic import after HOME is redirected. compaction.ts captures
// `homedir()` at module-load time → MUST set HOME before importing.
let createCompactionHook: typeof import("@/compaction/index").createCompactionHook;
let listMemoriesMock: ReturnType<typeof mock>;
let addMemoryMock: ReturnType<typeof mock>;
let originalListMemories: unknown;
let originalAddMemory: unknown;
let TMP_HOME: string;
let ORIGINAL_HOME: string | undefined;

beforeAll(async () => {
  TMP_HOME = createTmpDir("compaction-threshold");
  ORIGINAL_HOME = process.env.HOME;
  process.env.HOME = TMP_HOME;

  const compactionMod = await import("@/compaction/index");
  const clientMod = await import("@/memory/client");
  createCompactionHook = compactionMod.createCompactionHook;

  // Mutate the singleton's methods directly. `supermemoryClient` is a
  // class instance, so these assignments create own-properties that
  // shadow the prototype methods. compaction.ts captured this same
  // singleton at its module-load, so it sees our overrides.
  const sm = clientMod.supermemoryClient as unknown as Record<string, unknown>;
  originalListMemories = sm.listMemories;
  originalAddMemory = sm.addMemory;
  listMemoriesMock = mock(async () => ({
    success: true,
    memories: [],
    pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
  }));
  addMemoryMock = mock(async () => ({ success: true, id: "mem_test_summary" }));
  sm.listMemories = listMemoriesMock;
  sm.addMemory = addMemoryMock;
});

afterAll(async () => {
  // Restore singleton methods so other parallel-running tests that
  // happen to touch the singleton see the original prototype methods.
  const clientMod = await import("@/memory/client");
  const sm = clientMod.supermemoryClient as unknown as Record<string, unknown>;
  if (originalListMemories !== undefined) sm.listMemories = originalListMemories;
  else delete sm.listMemories;
  if (originalAddMemory !== undefined) sm.addMemory = originalAddMemory;
  else delete sm.addMemory;

  if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME;
  else delete process.env.HOME;
  cleanupTmpDir(TMP_HOME);
});

// =====================================================================
// Helpers
// =====================================================================

interface MockCtx {
  ctx: Parameters<typeof createCompactionHook>[0];
  summarize: ReturnType<typeof mock>;
  messages: ReturnType<typeof mock>;
  promptAsync: ReturnType<typeof mock>;
  showToast: ReturnType<typeof mock>;
}

function makeCtx(): MockCtx {
  const summarize = mock(async () => ({}));
  const messages = mock(async () => ({ data: [] }));
  const promptAsync = mock(async () => ({}));
  const showToast = mock(async () => ({}));
  const ctx = {
    directory: "/test/cwd",
    client: {
      session: { summarize, messages, promptAsync },
      tui: { showToast },
    },
  } as unknown as Parameters<typeof createCompactionHook>[0];
  return { ctx, summarize, messages, promptAsync, showToast };
}

// Builds a `message.updated` event payload for an assistant message.
// totalUsed = input + cacheRead + output (matches compaction.ts:342).
function makeAssistantEvent(opts: {
  sessionID?: string;
  messageID?: string;
  input: number;
  cacheRead: number;
  output: number;
  summary?: boolean;
  hasTokens?: boolean;
}) {
  const sessionID = opts.sessionID ?? `ses_${Math.random().toString(36).slice(2, 8)}`;
  const info: Record<string, unknown> = {
    id: opts.messageID ?? "msg_test",
    role: "assistant",
    sessionID,
    providerID: "test-provider",
    modelID: "test-model",
    finish: true,
  };
  if (opts.summary !== undefined) info.summary = opts.summary;
  if (opts.hasTokens !== false) {
    info.tokens = {
      input: opts.input,
      output: opts.output,
      cache: { read: opts.cacheRead, write: 0 },
    };
  }
  return {
    type: "message.updated",
    properties: { info },
  };
}

const TAGS = { user: "user_tag", project: "project_tag" };

// =====================================================================
// Tests
// =====================================================================

describe("createCompactionHook — threshold gate", () => {
  // Use a fresh session ID per test (and a fresh hook instance) so the
  // internal lastCompactionTime / compactionInProgress / summarizedSessions
  // maps don't bleed across cases.
  let sessionID: string;

  beforeEach(() => {
    sessionID = `ses_${Math.random().toString(36).slice(2, 10)}`;
  });

  it("BELOW threshold: ratio 0.79 (158_000 / 200_000) does NOT trigger summarize", async () => {
    const { ctx, summarize } = makeCtx();
    const hook = createCompactionHook(ctx, TAGS);
    // totalUsed = 100_000 + 28_000 + 30_000 = 158_000 → ratio 0.79 < 0.8.
    await hook.event({ event: makeAssistantEvent({ sessionID, input: 100_000, cacheRead: 28_000, output: 30_000 }) });
    expect(summarize).not.toHaveBeenCalled();
  });

  it("AT threshold: ratio 0.80 (160_000 / 200_000) DOES trigger summarize — the check is `ratio < threshold` (strict <)", async () => {
    const { ctx, summarize } = makeCtx();
    const hook = createCompactionHook(ctx, TAGS);
    // totalUsed = 100_000 + 30_000 + 30_000 = 160_000 → ratio 0.80.
    await hook.event({ event: makeAssistantEvent({ sessionID, input: 100_000, cacheRead: 30_000, output: 30_000 }) });
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize.mock.calls[0]?.[0]).toMatchObject({
      path: { id: sessionID },
      body: { providerID: "test-provider", modelID: "test-model" },
      query: { directory: "/test/cwd" },
    });
  });

  it("ABOVE threshold: ratio 0.90 (180_000 / 200_000) triggers summarize", async () => {
    const { ctx, summarize } = makeCtx();
    const hook = createCompactionHook(ctx, TAGS);
    // totalUsed = 120_000 + 30_000 + 30_000 = 180_000 → ratio 0.90.
    await hook.event({ event: makeAssistantEvent({ sessionID, input: 120_000, cacheRead: 30_000, output: 30_000 }) });
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("COOLDOWN: after a successful trigger, a second event within 30_000 ms for the same sessionID is suppressed", async () => {
    const { ctx, summarize } = makeCtx();
    const hook = createCompactionHook(ctx, TAGS);

    // First event triggers compaction (ratio 0.90).
    await hook.event({
      event: makeAssistantEvent({ sessionID, messageID: "msg_first", input: 120_000, cacheRead: 30_000, output: 30_000 }),
    });
    expect(summarize).toHaveBeenCalledTimes(1);

    // Second event immediately after — still above threshold, but cooldown
    // (now - lastCompactionTime < 30_000) must short-circuit at line 319.
    await hook.event({
      event: makeAssistantEvent({ sessionID, messageID: "msg_second", input: 120_000, cacheRead: 30_000, output: 30_000 }),
    });
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("MIN_TOKENS guard: totalUsed below 50_000 skips trigger even when usageRatio would exceed threshold", async () => {
    const { ctx, summarize } = makeCtx();
    // Custom small context limit → 40_000 / 30_000 = 1.33 (way over 0.8).
    // But MIN_TOKENS_FOR_COMPACTION (50_000) check fires FIRST (line 344).
    const hook = createCompactionHook(ctx, TAGS, { getModelLimit: () => 30_000 });
    await hook.event({ event: makeAssistantEvent({ sessionID, input: 20_000, cacheRead: 10_000, output: 10_000 }) });
    expect(summarize).not.toHaveBeenCalled();
  });

  it("CUSTOM threshold: options.threshold=0.5 makes ratio 0.6 trigger summarize (would NOT trigger under the default 0.8)", async () => {
    const { ctx, summarize } = makeCtx();
    const hook = createCompactionHook(ctx, TAGS, { threshold: 0.5 });
    // totalUsed = 80_000 + 20_000 + 20_000 = 120_000 → ratio 0.60.
    // 0.60 < 0.80 (default) ⇒ would NOT trigger.
    // 0.60 ≥ 0.50 (custom)  ⇒ DOES trigger.
    await hook.event({ event: makeAssistantEvent({ sessionID, input: 80_000, cacheRead: 20_000, output: 20_000 }) });
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("SUMMARY routing: an assistant message with summary===true bypasses checkAndTriggerCompaction entirely (no summarize call)", async () => {
    const { ctx, summarize } = makeCtx();
    const hook = createCompactionHook(ctx, TAGS);
    // Even with high usage, summary===true short-circuits at line 495 to
    // handleSummaryMessage, NOT checkAndTriggerCompaction.
    await hook.event({
      event: makeAssistantEvent({ sessionID, input: 120_000, cacheRead: 30_000, output: 30_000, summary: true }),
    });
    expect(summarize).not.toHaveBeenCalled();
  });

  it("NO-TOKENS guard: an assistant message with no `tokens` field is silently skipped (tokens check at line 324)", async () => {
    const { ctx, summarize } = makeCtx();
    const hook = createCompactionHook(ctx, TAGS);
    await hook.event({ event: makeAssistantEvent({ sessionID, input: 0, cacheRead: 0, output: 0, hasTokens: false }) });
    expect(summarize).not.toHaveBeenCalled();
  });

  it("CUSTOM context limit via getModelLimit lowers contextLimit, raising the effective usage ratio", async () => {
    const { ctx, summarize } = makeCtx();
    // contextLimit = 100_000; totalUsed = 90_000 → ratio 0.90 (would be
    // 0.45 under DEFAULT_CONTEXT_LIMIT=200_000 → would NOT trigger).
    const hook = createCompactionHook(ctx, TAGS, { getModelLimit: () => 100_000 });
    await hook.event({ event: makeAssistantEvent({ sessionID, input: 50_000, cacheRead: 20_000, output: 20_000 }) });
    expect(summarize).toHaveBeenCalledTimes(1);
  });
});
