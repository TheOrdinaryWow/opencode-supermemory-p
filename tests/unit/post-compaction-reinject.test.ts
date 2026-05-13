import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";

import type { Part } from "@opencode-ai/sdk";

import type { ChatClientLike, ChatHandlerDeps } from "@/chat/handler";
import { handleChatMessage } from "@/chat/handler";
import { handleSessionCompacted, pendingReinjectSessions } from "@/compaction/post-reinject";
import type { SupermemoryConfig } from "@/config/schema";
import { handleEvent } from "@/events/handler";
import { createSessionState } from "@/session/state";

const enabledConfig = { postCompactionReinject: true } as SupermemoryConfig;
const disabledConfig = { postCompactionReinject: false } as SupermemoryConfig;

interface CallLog {
  getProfile: Array<[string, string | undefined]>;
  searchMemories: Array<[string, string | string[]]>;
  listMemories: Array<[string, number | undefined]>;
}

interface FakeClient extends ChatClientLike {
  calls: CallLog;
}

function createFakeClient(): FakeClient {
  const calls: CallLog = { getProfile: [], searchMemories: [], listMemories: [] };
  return {
    calls,
    async getProfile(tag, query) {
      calls.getProfile.push([tag, query]);
      return { success: true, profile: { static: [], dynamic: [] } };
    },
    async searchMemories(query, tag) {
      calls.searchMemories.push([query, tag]);
      return { success: true, results: [{ memory: `Memory for ${query}`, similarity: 0.91 }] };
    },
    async listMemories(tag, limit) {
      calls.listMemories.push([tag, limit]);
      return { success: true, memories: [{ id: "mem_project", summary: "Project memory" }] };
    },
  };
}

function createDeps(): ChatHandlerDeps & { client: FakeClient; logs: Array<{ msg: string; data?: unknown }> } {
  const logs: Array<{ msg: string; data?: unknown }> = [];
  const injectedSessions = createSessionState();
  const client = createFakeClient();
  return {
    client,
    config: {
      keywordPatterns: [],
      recallKeywordPatterns: ["remind me"],
      maxProjectMemories: 10,
      injectProfile: true,
      maxProfileItems: 5,
      memoUsageFooter: true,
      everyMessageRecall: false,
      reinjectEveryN: 0,
    } as ChatHandlerDeps["config"],
    tags: { user: "u-tag", project: "p-tag" },
    injectedSessions,
    pendingReinjectSessions,
    log: (msg, data) => logs.push({ msg, data }),
    isConfigured: () => true,
    logs,
  };
}

function outputFor(text: string, sessionID: string, turn: number) {
  const messageID = `msg_${sessionID}_${turn}`;
  const part: Part = {
    id: `prt_${messageID}`,
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: false,
  } as Part;
  return { message: { id: messageID }, parts: [part] };
}

function contextParts(output: { parts: Part[] }) {
  return output.parts.filter((part) => part.type === "text" && "text" in part && part.text.includes("[SUPERMEMORY]"));
}

beforeEach(() => {
  pendingReinjectSessions.clear();
});

afterEach(() => {
  setSystemTime();
});

describe("post-compaction recall re-injection", () => {
  it("queues compacted sessions when post-compaction re-injection is enabled", async () => {
    await handleEvent(
      { event: { type: "session.compacted", properties: { sessionID: "ses_compacted" } } },
      { compactionHook: null, config: enabledConfig },
    );

    expect(pendingReinjectSessions.has("ses_compacted")).toBe(true);
  });

  it("runs recall on the next chat message for a pending session", async () => {
    const deps = createDeps();
    deps.injectedSessions.markInjected("ses_pending");
    pendingReinjectSessions.add("ses_pending");
    const output = outputFor("restore my context", "ses_pending", 1);

    await handleChatMessage({ sessionID: "ses_pending" }, output, deps);

    expect(contextParts(output)).toHaveLength(1);
    expect(deps.client.calls.searchMemories).toEqual([["restore my context", ["u-tag", "p-tag"]]]);
  });

  it("does not inject twice after the pending session is consumed", async () => {
    const deps = createDeps();
    deps.injectedSessions.markInjected("ses_once");
    pendingReinjectSessions.add("ses_once");
    const first = outputFor("restore once", "ses_once", 1);
    const second = outputFor("plain follow-up", "ses_once", 2);

    await handleChatMessage({ sessionID: "ses_once" }, first, deps);
    setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 3)));
    await handleChatMessage({ sessionID: "ses_once" }, second, deps);

    expect(contextParts(first)).toHaveLength(1);
    expect(contextParts(second)).toHaveLength(0);
    expect(deps.client.calls.searchMemories).toHaveLength(1);
  });

  it("skips queueing when post-compaction re-injection is disabled", () => {
    handleSessionCompacted({ event: { properties: { sessionID: "ses_disabled" } } }, disabledConfig);

    expect(pendingReinjectSessions.has("ses_disabled")).toBe(false);
  });

  it("clears the pending session after recall is consumed", async () => {
    const deps = createDeps();
    deps.injectedSessions.markInjected("ses_clear");
    pendingReinjectSessions.add("ses_clear");
    const output = outputFor("clear pending", "ses_clear", 1);

    await handleChatMessage({ sessionID: "ses_clear" }, output, deps);

    expect(pendingReinjectSessions.has("ses_clear")).toBe(false);
  });
});
