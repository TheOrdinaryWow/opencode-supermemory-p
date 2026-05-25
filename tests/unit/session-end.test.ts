import { describe, expect, it, mock } from "bun:test";

import { type EventSessionDeleted, type EventSessionIdle, handleSessionEnd, type SessionEndDeps } from "@/capture/session-end";
import { DEFAULTS } from "@/config/defaults";
import { type SupermemoryConfig, SupermemoryConfigSchema } from "@/config/schema";
import { extractSignalContent } from "@/signal/extract";

function makeConfig(overrides: Partial<SupermemoryConfig> = {}): SupermemoryConfig {
  return SupermemoryConfigSchema.parse({
    ...DEFAULTS,
    projectContainerTag: "project-tag",
    signalExtraction: false,
    ...overrides,
  });
}

function makeDeletedEvent(sessionId: string): EventSessionDeleted {
  return { event: { type: "session.deleted", properties: { info: { id: sessionId } } } };
}

function makeIdleEvent(sessionId: string): EventSessionIdle {
  return { event: { type: "session.idle", properties: { sessionID: sessionId } } };
}

function makeMessage(id: string, role: "user" | "assistant", text: string) {
  return {
    info: { id, role, sessionID: "ses_test" },
    parts: [{ type: "text", text }],
  };
}

function makeDeps(overrides: Partial<SessionEndDeps> = {}) {
  const getLastCaptured = mock(async () => null);
  const pruneOldTrackers = mock(async () => 0);
  const addMemory = mock(async (_content: string, _containerTag: string, _metadata?: { type: string; source?: string }) => ({
    success: true as const,
    id: "mem_1",
  }));
  const messages = mock(async () => ({
    data: [makeMessage("msg_1", "user", "Remember this project decision."), makeMessage("msg_2", "assistant", "Saved.")],
  }));
  const deps: SessionEndDeps = {
    config: makeConfig(),
    client: { addMemory } as unknown as SessionEndDeps["client"],
    sdkClient: { session: { messages } },
    tracker: { getLastCaptured, pruneOldTrackers },
    signalExtract: extractSignalContent,
    dataDir: "/tmp/project",
    projectTag: "project-tag",
    ...overrides,
  };

  return { deps, getLastCaptured, pruneOldTrackers, addMemory, messages };
}

describe("handleSessionEnd", () => {
  it("saves a deleted session once", async () => {
    const { deps, addMemory, messages } = makeDeps();

    await handleSessionEnd(makeDeletedEvent("ses_deleted_once"), deps);

    expect(messages).toHaveBeenCalledWith({ sessionId: "ses_deleted_once" });
    expect(addMemory).toHaveBeenCalledTimes(1);
    expect(addMemory.mock.calls[0]?.[0]).toContain("[user] Remember this project decision.");
    expect(addMemory.mock.calls[0]?.[1]).toBe("project-tag");
    expect(addMemory.mock.calls[0]?.[2]).toEqual({ type: "conversation", source: "summary" });
  });

  it("deduplicates idle and deleted events for the same session", async () => {
    const { deps, addMemory } = makeDeps();

    await handleSessionEnd(makeIdleEvent("ses_dedup_pair"), deps);
    await handleSessionEnd(makeDeletedEvent("ses_dedup_pair"), deps);

    expect(addMemory).toHaveBeenCalledTimes(1);
  });

  it("deduplicates idle and deleted events fired CONCURRENTLY for the same session", async () => {
    // Regression: previously `savedSessions.add` ran AFTER all awaits
    // (tracker fetch, session messages fetch, addMemory). Two events for
    // the same session that landed in that ~60ms window both passed the
    // `has()` check and both wrote a duplicate memory. The fix reserves
    // the slot immediately after the has() check.
    let resolveMessages: (value: unknown) => void = () => {};
    const messagesPromise = new Promise((resolve) => {
      resolveMessages = resolve;
    });
    const messages = mock(async () => {
      await messagesPromise;
      return { data: [makeMessage("msg_1", "user", "Remember the deploy flag.")] };
    });
    const { deps, addMemory } = makeDeps({ sdkClient: { session: { messages } } });

    // Fire both events without awaiting between them — simulates the
    // real OpenCode flow where idle and deleted arrive back-to-back.
    const idlePromise = handleSessionEnd(makeIdleEvent("ses_race"), deps);
    const deletedPromise = handleSessionEnd(makeDeletedEvent("ses_race"), deps);
    resolveMessages({});
    await Promise.all([idlePromise, deletedPromise]);

    expect(addMemory).toHaveBeenCalledTimes(1);
  });

  it("skips empty sessions", async () => {
    const messages = mock(async () => ({ data: [] }));
    const { deps, addMemory } = makeDeps({ sdkClient: { session: { messages } } });

    await handleSessionEnd(makeIdleEvent("ses_empty"), deps);

    expect(addMemory).toHaveBeenCalledTimes(0);
  });

  it("skips when signal extraction finds no keyword match", async () => {
    const { deps, addMemory } = makeDeps({
      config: makeConfig({ signalExtraction: true, signalKeywords: ["durable-signal"] }),
    });

    await handleSessionEnd(makeIdleEvent("ses_no_signal"), deps);

    expect(addMemory).toHaveBeenCalledTimes(0);
  });

  it("saves only messages after the tracker watermark", async () => {
    const getLastCaptured = mock(async () => "msg_1");
    const messages = mock(async () => ({
      data: [makeMessage("msg_1", "user", "Already captured."), makeMessage("msg_2", "assistant", "New uncaptured turn.")],
    }));
    const { deps, addMemory } = makeDeps({
      tracker: { getLastCaptured, pruneOldTrackers: mock(async () => 0) },
      sdkClient: { session: { messages } },
    });

    await handleSessionEnd(makeIdleEvent("ses_tracker_delta"), deps);

    expect(addMemory).toHaveBeenCalledTimes(1);
    expect(addMemory.mock.calls[0]?.[0]).toBe("[assistant] New uncaptured turn.");
  });

  it("prunes old trackers after deleted sessions", async () => {
    const { deps, pruneOldTrackers } = makeDeps();

    await handleSessionEnd(makeDeletedEvent("ses_prune_deleted"), deps);

    expect(pruneOldTrackers).toHaveBeenCalledWith("/tmp/project/capture-trackers");
  });
});
