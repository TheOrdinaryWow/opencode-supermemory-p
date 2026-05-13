import { describe, expect, it } from "bun:test";

import { extractSignalContent, findSignalTurns, getContextualTurns, groupIntoTurns, type Message, type Turn } from "@/signal/extract";

function textMessage(id: string, role: Message["role"], text: string): Message {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
  };
}

describe("signal extraction", () => {
  it("groups interleaved messages into turns", () => {
    const turns = groupIntoTurns([
      textMessage("u1", "user", "First request"),
      textMessage("a1", "assistant", "First reply"),
      textMessage("u2", "user", "Second request"),
    ]);

    expect(turns).toEqual([
      { role: "user", text: "First request", messageId: "u1" },
      { role: "assistant", text: "First reply", messageId: "a1" },
      { role: "user", text: "Second request", messageId: "u2" },
    ]);
  });

  it("returns matching user turn indices", () => {
    const turns: Turn[] = [
      { role: "user", text: "This is important", messageId: "u1" },
      { role: "assistant", text: "important assistant context", messageId: "a1" },
      { role: "user", text: "Please remember the API shape", messageId: "u2" },
    ];

    expect(findSignalTurns(turns, ["remember", "important"])).toEqual([0, 2]);
  });

  it("returns empty indices when no keyword matches", () => {
    const turns: Turn[] = [{ role: "user", text: "Please run the test", messageId: "u1" }];

    expect(findSignalTurns(turns, ["remember"])).toEqual([]);
  });

  it("collects signal turns with prior context without duplicate overlap", () => {
    const turns: Turn[] = [
      { role: "user", text: "Setup", messageId: "u1" },
      { role: "assistant", text: "Reply", messageId: "a1" },
      { role: "user", text: "remember alpha", messageId: "u2" },
      { role: "assistant", text: "Ack", messageId: "a2" },
      { role: "user", text: "remember beta", messageId: "u3" },
    ];

    expect(getContextualTurns(turns, [2, 4], 2)).toEqual(turns);
  });

  it("handles a signal at the first turn", () => {
    const turns: Turn[] = [
      { role: "user", text: "remember root", messageId: "u1" },
      { role: "assistant", text: "Ack", messageId: "a1" },
    ];

    expect(getContextualTurns(turns, [0], 3)).toEqual([{ role: "user", text: "remember root", messageId: "u1" }]);
  });

  it("returns null when keywords are absent", () => {
    const messages = [textMessage("u1", "user", "Please inspect this file")];

    expect(extractSignalContent(messages, { signalKeywords: ["remember"], signalTurnsBefore: 1 })).toBeNull();
  });

  it("returns concatenated content for matched turns and context", () => {
    const messages = [
      textMessage("u1", "user", "Earlier context"),
      textMessage("a1", "assistant", "Assistant context"),
      textMessage("u2", "user", "Remember the release uses Bun"),
    ];

    expect(extractSignalContent(messages, { signalKeywords: ["remember"], signalTurnsBefore: 1 })).toBe(
      "[assistant] Assistant context\n[user] Remember the release uses Bun",
    );
  });

  it("skips long user turns during signal detection", () => {
    const longPaste = `${"x".repeat(50 * 1024 + 1)} remember this`;
    const turns: Turn[] = [{ role: "user", text: longPaste, messageId: "u1" }];

    expect(findSignalTurns(turns, ["remember"])).toEqual([]);
  });

  it("skips command-like user turns during signal detection", () => {
    const turns: Turn[] = [
      { role: "user", text: "/remember this", messageId: "u1" },
      { role: "user", text: "\\note this", messageId: "u2" },
    ];

    expect(findSignalTurns(turns, ["remember", "note"])).toEqual([]);
  });

  it("matches signal keywords without case sensitivity", () => {
    const turns: Turn[] = [{ role: "user", text: "This is IMPORTANT", messageId: "u1" }];

    expect(findSignalTurns(turns, ["important"])).toEqual([0]);
  });

  it("deduplicates overlapping context windows for two signals", () => {
    const turns: Turn[] = [
      { role: "user", text: "One", messageId: "u1" },
      { role: "assistant", text: "Two", messageId: "a1" },
      { role: "user", text: "remember three", messageId: "u2" },
      { role: "assistant", text: "Four", messageId: "a2" },
      { role: "user", text: "remember five", messageId: "u3" },
    ];

    expect(getContextualTurns(turns, [2, 4], 1)).toEqual([
      { role: "assistant", text: "Two", messageId: "a1" },
      { role: "user", text: "remember three", messageId: "u2" },
      { role: "assistant", text: "Four", messageId: "a2" },
      { role: "user", text: "remember five", messageId: "u3" },
    ]);
  });

  it("returns null for an empty message list", () => {
    expect(extractSignalContent([], { signalKeywords: ["remember"], signalTurnsBefore: 2 })).toBeNull();
  });
});
