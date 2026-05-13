import { afterEach, describe, expect, it, setSystemTime } from "bun:test";

import type { Part } from "@opencode-ai/sdk";

import type { ChatClientLike, ChatHandlerDeps } from "@/chat/handler";
import { handleChatMessage } from "@/chat/handler";
import { shouldPeriodicReinject } from "@/recall/periodic";
import { createSessionState } from "@/session/state";

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

function createDeps(config: Partial<ChatHandlerDeps["config"] & { reinjectEveryN: number }> = {}): ChatHandlerDeps & {
  client: FakeClient;
  logs: Array<{ msg: string; data?: unknown }>;
} {
  const logs: Array<{ msg: string; data?: unknown }> = [];
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
      ...config,
    } as ChatHandlerDeps["config"],
    tags: { user: "u-tag", project: "p-tag" },
    injectedSessions: createSessionState(),
    pendingReinjectSessions: new Set<string>(),
    log: (msg, data) => logs.push({ msg, data }),
    isConfigured: () => true,
    logs,
  };
}

function textPart(text: string, sessionID: string, messageID: string): Part {
  return {
    id: `prt_${messageID}`,
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: false,
  } as Part;
}

function outputFor(text: string, sessionID: string, turn: number) {
  const messageID = `msg_${sessionID}_${turn}`;
  return { message: { id: messageID }, parts: [textPart(text, sessionID, messageID)] };
}

function contextParts(output: { parts: Part[] }) {
  return output.parts.filter((part) => part.type === "text" && "text" in part && part.text.includes("[SUPERMEMORY]"));
}

afterEach(() => {
  setSystemTime();
});

describe("periodic recall re-injection", () => {
  it("keeps reinjectEveryN=0 disabled", () => {
    const counter = new Map([["ses_1", 3]]);

    expect(shouldPeriodicReinject("ses_1", 0, counter)).toBe(false);
  });

  it("fires at turn 4 when reinjectEveryN is 3", async () => {
    const deps = createDeps({ reinjectEveryN: 3 });
    const outputs = [];

    for (let turn = 1; turn <= 4; turn += 1) {
      setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, turn * 3)));
      const output = outputFor(`turn ${turn}`, "cadence-session", turn);
      outputs.push(output);
      await handleChatMessage({ sessionID: "cadence-session" }, output, deps);
    }

    expect(contextParts(outputs[0]!)).toHaveLength(1);
    expect(contextParts(outputs[1]!)).toHaveLength(0);
    expect(contextParts(outputs[2]!)).toHaveLength(0);
    expect(contextParts(outputs[3]!)).toHaveLength(1);
    expect(deps.client.calls.searchMemories).toEqual([
      ["turn 1", "u-tag"],
      ["turn 4", ["u-tag", "p-tag"]],
    ]);
  });

  it("tracks periodic counters per session", async () => {
    const deps = createDeps({ reinjectEveryN: 3 });

    for (let turn = 1; turn <= 4; turn += 1) {
      setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 1, turn * 3)));
      await handleChatMessage({ sessionID: "ready-session" }, outputFor(`ready ${turn}`, "ready-session", turn), deps);
    }

    const otherOutput = outputFor("other 1", "other-session", 1);
    await handleChatMessage({ sessionID: "other-session" }, otherOutput, deps);

    expect(deps.client.calls.searchMemories).toEqual([
      ["ready 1", "u-tag"],
      ["ready 4", ["u-tag", "p-tag"]],
      ["other 1", "u-tag"],
    ]);
    expect(contextParts(otherOutput)).toHaveLength(1);
  });

  it("avoids double injection when every-message recall already ran", async () => {
    const deps = createDeps({ everyMessageRecall: true, reinjectEveryN: 3 });

    for (let turn = 1; turn <= 4; turn += 1) {
      setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 2, turn * 3)));
      const output = outputFor(`double ${turn}`, "double-session", turn);
      await handleChatMessage({ sessionID: "double-session" }, output, deps);

      expect(contextParts(output)).toHaveLength(1);
    }

    expect(deps.client.calls.searchMemories).toEqual([
      ["double 1", "u-tag"],
      ["double 2", ["u-tag", "p-tag"]],
      ["double 3", ["u-tag", "p-tag"]],
      ["double 4", ["u-tag", "p-tag"]],
    ]);
  });

  it("keeps independent sessions on separate cadences", async () => {
    const deps = createDeps({ reinjectEveryN: 3 });

    for (let turn = 1; turn <= 4; turn += 1) {
      setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 3, turn * 4)));
      await handleChatMessage({ sessionID: "alpha" }, outputFor(`alpha ${turn}`, "alpha", turn), deps);
      await handleChatMessage({ sessionID: "beta" }, outputFor(`beta ${turn}`, "beta", turn), deps);
    }

    expect(deps.client.calls.searchMemories).toEqual([
      ["alpha 1", "u-tag"],
      ["beta 1", "u-tag"],
      ["alpha 4", ["u-tag", "p-tag"]],
      ["beta 4", ["u-tag", "p-tag"]],
    ]);
  });
});
