import { describe, expect, it, mock, spyOn } from "bun:test";

import { handlePreCompactionSave, type PreSaveDeps } from "@/compaction/pre-save";
import { DEFAULTS } from "@/config/defaults";
import { type SupermemoryConfig, SupermemoryConfigSchema } from "@/config/schema";
import type { Message } from "@/signal/extract";

function makeConfig(overrides: Partial<SupermemoryConfig> = {}): SupermemoryConfig {
  return SupermemoryConfigSchema.parse({
    ...DEFAULTS,
    projectContainerTag: "project-tag",
    ...overrides,
  });
}

function makeMessage(id: string, role: "user" | "assistant", text: string, parts: Message["parts"] = [{ type: "text", text }]): Message {
  return { id, role, sessionID: "ses_pre_save", parts };
}

function makeDeps(messagesList: Message[], overrides: Partial<PreSaveDeps> = {}) {
  const addMemory = mock(async (_content: string, _containerTag: string, _metadata?: { type: string }) => ({
    ok: true as const,
    value: { success: true as const, id: "mem_1" },
  }));
  const messages = mock(async (_args: { sessionId: string }) => ({ messages: messagesList }));
  const deps: PreSaveDeps = {
    config: makeConfig(),
    client: { addMemory } as unknown as PreSaveDeps["client"],
    sdkSession: { messages },
    ...overrides,
  };

  return { deps, addMemory, messages };
}

describe("handlePreCompactionSave", () => {
  it("saves the last user and assistant turns and mutates context", async () => {
    const input = { sessionID: "ses_pre_save", output: { context: [] as string[] } };
    const { deps, addMemory, messages } = makeDeps([
      makeMessage("msg_1", "user", "Remember this decision."),
      makeMessage("msg_2", "assistant", "Saved."),
    ]);

    await handlePreCompactionSave(input, deps);

    expect(messages).toHaveBeenCalledWith({ sessionId: "ses_pre_save" });
    expect(addMemory).toHaveBeenCalledTimes(1);
    expect(addMemory.mock.calls[0]?.[0]).toBe("[user] Remember this decision.\n[assistant] Saved.");
    expect(addMemory.mock.calls[0]?.[1]).toBe("project-tag");
    expect(addMemory.mock.calls[0]?.[2]).toEqual({ type: "conversation" });
    expect(input.output.context).toEqual(["Memories preserved in Supermemory."]);
  });

  it("filters synthetic ignored and compaction parts before saving", async () => {
    const input = { sessionID: "ses_filter", output: { context: [] as string[] } };
    const { deps, addMemory } = makeDeps([
      makeMessage("msg_1", "user", "", [
        { type: "text", text: "kept user text" },
        { type: "text", text: "synthetic text", synthetic: true },
        { type: "text", text: "ignored text", ignored: true },
        { type: "compaction", text: "summary text" },
      ]),
      makeMessage("msg_2", "assistant", "kept assistant text"),
    ]);

    await handlePreCompactionSave(input, deps);

    expect(addMemory.mock.calls[0]?.[0]).toBe("[user] kept user text\n[assistant] kept assistant text");
  });

  it("treats deduped addMemory results as preserved", async () => {
    const input = { sessionID: "ses_dedup", output: { context: [] as string[] } };
    const addMemory = mock(async () => ({ ok: true as const, value: { success: true as const, deduped: true as const } }));
    const { deps } = makeDeps([makeMessage("msg_1", "user", "Already stored.")], {
      client: { addMemory } as unknown as PreSaveDeps["client"],
    });

    await handlePreCompactionSave(input, deps);

    expect(addMemory).toHaveBeenCalledTimes(1);
    expect(input.output.context).toContain("Memories preserved in Supermemory.");
  });

  it("does not block compaction when the API fails", async () => {
    const input = { sessionID: "ses_failure", output: { context: [] as string[] } };
    const addMemory = mock(async () => {
      throw new Error("api down");
    });
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const { deps } = makeDeps([makeMessage("msg_1", "user", "Keep this despite failure.")], {
      client: { addMemory } as unknown as PreSaveDeps["client"],
    });

    const result = await handlePreCompactionSave(input, deps);

    expect(result).toBeUndefined();
    expect(input.output.context).toContain("Memories preserved in Supermemory.");
    warnSpy.mockRestore();
  });

  it("mutates only output.context", async () => {
    const input = {
      sessionID: "ses_context_only",
      output: { context: [] as string[], prompt: "original prompt" } as { context: string[]; prompt: string },
    };
    const { deps } = makeDeps([makeMessage("msg_1", "assistant", "Preserve this turn.")]);

    await handlePreCompactionSave(input, deps);

    expect(input.output.context).toEqual(["Memories preserved in Supermemory."]);
    expect(input.output.prompt).toBe("original prompt");
  });
});
