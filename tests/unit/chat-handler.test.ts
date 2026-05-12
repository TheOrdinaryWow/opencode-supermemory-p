import { describe, expect, it } from "bun:test";

import type { Part } from "@opencode-ai/sdk";

import type { ChatClientLike, ChatHandlerDeps } from "@/chat/handler";
import { handleChatMessage } from "@/chat/handler";
import { detectMemoryKeyword } from "@/chat/keywords";
import { MEMORY_NUDGE_MESSAGE, removeCodeBlocks } from "@/chat/nudge";
import { createSessionState } from "@/session/state";

// ---------------------------------------------------------------------------
// Test-only helpers
// ---------------------------------------------------------------------------

interface CallLog {
  getProfile: Array<[string, string | undefined]>;
  searchMemories: Array<[string, string]>;
  listMemories: Array<[string, number | undefined]>;
}

interface FakeClient extends ChatClientLike {
  calls: CallLog;
}

function createFakeClient(overrides: Partial<ChatClientLike> = {}): FakeClient {
  const calls: CallLog = { getProfile: [], searchMemories: [], listMemories: [] };
  const client: FakeClient = {
    calls,
    async getProfile(tag, query) {
      calls.getProfile.push([tag, query]);
      if (overrides.getProfile) return overrides.getProfile(tag, query);
      return { success: true, profile: { static: [], dynamic: [] } };
    },
    async searchMemories(query, tag) {
      calls.searchMemories.push([query, tag]);
      if (overrides.searchMemories) return overrides.searchMemories(query, tag);
      return { success: true, results: [] };
    },
    async listMemories(tag, limit) {
      calls.listMemories.push([tag, limit]);
      if (overrides.listMemories) return overrides.listMemories(tag, limit);
      return { success: true, memories: [] };
    },
  };
  return client;
}

function createDeps(overrides: Partial<ChatHandlerDeps> = {}): ChatHandlerDeps & {
  logs: Array<{ msg: string; data?: unknown }>;
  client: FakeClient;
} {
  const logs: Array<{ msg: string; data?: unknown }> = [];
  const client = (overrides.client as FakeClient) ?? createFakeClient();
  return {
    client,
    config: {
      keywordPatterns: ["remember", "save\\s+this"],
      maxProjectMemories: 10,
      ...((overrides.config as object) ?? {}),
    } as ChatHandlerDeps["config"],
    tags: overrides.tags ?? { user: "u-tag", project: "p-tag" },
    injectedSessions: overrides.injectedSessions ?? createSessionState(),
    log: (msg, data) => logs.push({ msg, data }),
    isConfigured: overrides.isConfigured ?? (() => true),
    logs,
  };
}

function textPart(text: string): Part {
  return {
    id: "prt_user_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "text",
    text,
    synthetic: false,
  } as Part;
}

function emptyOutput(parts: Part[] = []) {
  return { message: { id: "msg_1" }, parts };
}

// ---------------------------------------------------------------------------
// detectMemoryKeyword
// ---------------------------------------------------------------------------

describe("detectMemoryKeyword", () => {
  const config = { keywordPatterns: ["remember", "save\\s+this", "don'?t\\s+forget"] };

  it("returns true when the content contains a trigger phrase", () => {
    expect(detectMemoryKeyword("please remember this project uses bun", config)).toBe(true);
  });

  it("returns false when the trigger only appears inside a fenced code block", () => {
    const text = "```\nremember to update this\n```\njust a quick note";
    expect(detectMemoryKeyword(text, config)).toBe(false);
  });

  it("returns false on empty keyword list", () => {
    expect(detectMemoryKeyword("remember this", { keywordPatterns: [] })).toBe(false);
  });

  it("removeCodeBlocks strips inline and fenced code", () => {
    expect(removeCodeBlocks("hello `world` end")).toBe("hello  end");
    expect(removeCodeBlocks("a ```js\nfoo\n``` b")).toBe("a  b");
  });
});

// ---------------------------------------------------------------------------
// handleChatMessage
// ---------------------------------------------------------------------------

describe("handleChatMessage", () => {
  it("injects a context part on the first message of a session", async () => {
    const deps = createDeps({
      client: createFakeClient({
        async getProfile() {
          return {
            success: true,
            profile: { static: ["Prefers concise responses"], dynamic: [] },
          };
        },
        async searchMemories() {
          return { success: true, results: [{ memory: "Uses bun, not Node", similarity: 0.9 }] };
        },
        async listMemories() {
          return {
            success: true,
            memories: [{ id: "mem_1", summary: "Build: bun run build", title: null, content: null }],
          };
        },
      }),
    });

    const output = emptyOutput([textPart("hi")]);
    await handleChatMessage({ sessionID: "ses_1" }, output, deps);

    expect(deps.injectedSessions.wasInjected("ses_1")).toBe(true);
    expect(output.parts).toHaveLength(2);
    const first = output.parts[0]!;
    expect(first.type).toBe("text");
    expect("synthetic" in first && first.synthetic).toBe(true);
    expect("text" in first && first.text).toContain("[SUPERMEMORY]");
    expect(deps.client.calls.searchMemories).toEqual([["hi", "u-tag"]]);
    expect(deps.client.calls.listMemories).toEqual([["p-tag", 10]]);
  });

  it("does NOT re-inject context on a subsequent message in the same session", async () => {
    const deps = createDeps();
    deps.injectedSessions.markInjected("ses_1");

    const output = emptyOutput([textPart("second message")]);
    await handleChatMessage({ sessionID: "ses_1" }, output, deps);

    expect(output.parts).toHaveLength(1); // only the original user part survives
    expect(deps.client.calls.searchMemories).toHaveLength(0);
    expect(deps.client.calls.listMemories).toHaveLength(0);
    expect(deps.client.calls.getProfile).toHaveLength(0);
  });

  it("appends the nudge part when a memory keyword is detected", async () => {
    const deps = createDeps();
    deps.injectedSessions.markInjected("ses_1"); // skip context-injection branch

    const output = emptyOutput([textPart("please remember that we use bun")]);
    await handleChatMessage({ sessionID: "ses_1" }, output, deps);

    const nudge = output.parts.find((p) => p.type === "text" && "text" in p && p.text === MEMORY_NUDGE_MESSAGE);
    expect(nudge).toBeDefined();
    expect(nudge && "synthetic" in nudge && nudge.synthetic).toBe(true);
  });

  it("skips entirely when isConfigured() returns false", async () => {
    const deps = createDeps({ isConfigured: () => false });
    const output = emptyOutput([textPart("hi")]);

    await handleChatMessage({ sessionID: "ses_x" }, output, deps);

    expect(output.parts).toHaveLength(1);
    expect(deps.injectedSessions.wasInjected("ses_x")).toBe(false);
    expect(deps.client.calls.searchMemories).toHaveLength(0);
    expect(deps.logs).toHaveLength(0);
  });

  it("returns early when the message has no text parts", async () => {
    const deps = createDeps();
    const output = emptyOutput([]);

    await handleChatMessage({ sessionID: "ses_1" }, output, deps);

    expect(output.parts).toHaveLength(0);
    expect(deps.client.calls.searchMemories).toHaveLength(0);
    expect(deps.logs.some((l) => l.msg.includes("no text parts"))).toBe(true);
  });

  it("swallows client errors and logs them without throwing", async () => {
    const deps = createDeps({
      client: createFakeClient({
        async searchMemories() {
          throw new Error("network down");
        },
      }),
    });
    const output = emptyOutput([textPart("hi")]);

    await handleChatMessage({ sessionID: "ses_err" }, output, deps);
    expect(deps.logs.some((l) => l.msg.includes("ERROR"))).toBe(true);
  });
});
