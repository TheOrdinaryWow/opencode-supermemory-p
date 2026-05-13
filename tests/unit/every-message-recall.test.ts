import { afterEach, describe, expect, it, setSystemTime } from "bun:test";

import type { Part } from "@opencode-ai/sdk";

import type { ChatClientLike, ChatHandlerDeps } from "@/chat/handler";
import { handleChatMessage } from "@/chat/handler";
import { runEveryMessageRecall } from "@/recall/every-message";
import { createSessionState } from "@/session/state";

interface CallLog {
  getProfile: Array<[string, string | undefined]>;
  searchMemories: Array<[string, string | string[]]>;
  listMemories: Array<[string, number | undefined]>;
}

interface FakeClient extends ChatClientLike {
  calls: CallLog;
}

function createFakeClient(overrides: Partial<ChatClientLike> = {}): FakeClient {
  const calls: CallLog = { getProfile: [], searchMemories: [], listMemories: [] };
  return {
    calls,
    async getProfile(tag, query) {
      calls.getProfile.push([tag, query]);
      if (overrides.getProfile) return overrides.getProfile(tag, query);
      return { success: true, profile: { static: [], dynamic: [] } };
    },
    async searchMemories(query, tag) {
      calls.searchMemories.push([query, tag]);
      if (overrides.searchMemories) return overrides.searchMemories(query, tag);
      return { success: true, results: [{ memory: "Uses Bun for project tasks", similarity: 0.91 }] };
    },
    async listMemories(tag, limit) {
      calls.listMemories.push([tag, limit]);
      if (overrides.listMemories) return overrides.listMemories(tag, limit);
      return { success: true, memories: [{ id: "mem_project", summary: "Build with bun run typecheck" }] };
    },
  };
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
      keywordPatterns: [],
      recallKeywordPatterns: ["remind me", "what did we"],
      maxProjectMemories: 10,
      injectProfile: true,
      maxProfileItems: 5,
      memoUsageFooter: true,
      everyMessageRecall: false,
      ...((overrides.config as object) ?? {}),
    } as ChatHandlerDeps["config"],
    tags: overrides.tags ?? { user: "u-tag", project: "p-tag" },
    injectedSessions: overrides.injectedSessions ?? createSessionState(),
    pendingReinjectSessions: overrides.pendingReinjectSessions ?? new Set<string>(),
    log: (msg, data) => logs.push({ msg, data }),
    isConfigured: overrides.isConfigured ?? (() => true),
    logs,
  };
}

function textPart(text: string, id = "prt_user_1"): Part {
  return {
    id,
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

function contextParts(output: { parts: Part[] }) {
  return output.parts.filter((part) => part.type === "text" && "text" in part && part.text.includes("[SUPERMEMORY]"));
}

afterEach(() => {
  setSystemTime();
});

describe("every-message recall", () => {
  it("keeps first-message context injection working", async () => {
    const deps = createDeps();
    const output = emptyOutput([textPart("hi")]);

    await handleChatMessage({ sessionID: "first-message" }, output, deps);

    expect(deps.injectedSessions.wasInjected("first-message")).toBe(true);
    expect(contextParts(output)).toHaveLength(1);
    expect(deps.client.calls.searchMemories).toEqual([["hi", "u-tag"]]);
  });

  it("runs recall on a later message when everyMessageRecall is true", async () => {
    const deps = createDeps({ config: { everyMessageRecall: true } as ChatHandlerDeps["config"] });
    deps.injectedSessions.markInjected("third-message");
    const output = emptyOutput([textPart("third message asks for context")]);

    await handleChatMessage({ sessionID: "third-message" }, output, deps);

    expect(contextParts(output)).toHaveLength(1);
    expect(deps.client.calls.searchMemories).toEqual([["third message asks for context", ["u-tag", "p-tag"]]]);
  });

  it("keeps everyMessageRecall false as first-message-only baseline", async () => {
    const deps = createDeps();
    const first = emptyOutput([textPart("first")]);
    const second = emptyOutput([textPart("second")]);

    await handleChatMessage({ sessionID: "baseline" }, first, deps);
    await handleChatMessage({ sessionID: "baseline" }, second, deps);

    expect(contextParts(first)).toHaveLength(1);
    expect(contextParts(second)).toHaveLength(0);
    expect(deps.client.calls.searchMemories).toEqual([["first", "u-tag"]]);
  });

  it("runs recall when a recall keyword is present", async () => {
    const deps = createDeps();
    deps.injectedSessions.markInjected("keyword-session");
    const output = emptyOutput([textPart("Can you remind me what library we chose?")]);

    await handleChatMessage({ sessionID: "keyword-session" }, output, deps);

    expect(contextParts(output)).toHaveLength(1);
    expect(deps.client.calls.searchMemories).toEqual([["Can you remind me what library we chose?", ["u-tag", "p-tag"]]]);
  });

  it("skips recall within the two-second session throttle", async () => {
    const deps = createDeps();
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const first = emptyOutput([textPart("first recall", "prt_user_1")]);
    const second = emptyOutput([textPart("second recall", "prt_user_2")]);

    await runEveryMessageRecall({ sessionID: "throttle-session" }, first, deps);
    setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    await runEveryMessageRecall({ sessionID: "throttle-session" }, second, deps);

    expect(contextParts(first)).toHaveLength(1);
    expect(contextParts(second)).toHaveLength(0);
    expect(deps.client.calls.searchMemories).toHaveLength(1);
  });

  it("strips inbound metadata before searching", async () => {
    const deps = createDeps();
    const output = emptyOutput([textPart("[2026-01-01T00:00:00Z] <system-reminder>hidden</system-reminder>actual query")]);

    await runEveryMessageRecall({ sessionID: "strip-session" }, output, deps);

    expect(deps.client.calls.searchMemories[0]).toEqual(["actual query", ["u-tag", "p-tag"]]);
  });

  it("does not inject context twice in one chat message", async () => {
    const deps = createDeps({ config: { everyMessageRecall: true } as ChatHandlerDeps["config"] });
    const output = emptyOutput([textPart("first turn with every-message recall enabled")]);

    await handleChatMessage({ sessionID: "single-inject" }, output, deps);

    expect(contextParts(output)).toHaveLength(1);
  });

  it("marks the injected recall part as synthetic", async () => {
    const deps = createDeps();
    const output = emptyOutput([textPart("synthetic check")]);

    await runEveryMessageRecall({ sessionID: "synthetic-session" }, output, deps);

    const [context] = contextParts(output);
    expect(context && "synthetic" in context && context.synthetic).toBe(true);
  });

  it("includes the memo usage footer from the context formatter", async () => {
    const deps = createDeps({ config: { memoUsageFooter: true } as ChatHandlerDeps["config"] });
    const output = emptyOutput([textPart("footer check")]);

    await runEveryMessageRecall({ sessionID: "footer-session" }, output, deps);

    const [context] = contextParts(output);
    expect(context && "text" in context && context.text).toContain("[Supermemory: 1 memories loaded]");
  });

  it("uses generated part identifiers for recall context", async () => {
    const deps = createDeps();
    const output = emptyOutput([textPart("id check")]);

    await runEveryMessageRecall({ sessionID: "id-session" }, output, deps);

    const [context] = contextParts(output);
    expect(context?.id).toMatch(/^prt_[a-f0-9]+[a-z0-9]{8}$/);
    expect(context?.id).not.toBe("prt_user_1");
  });
});
