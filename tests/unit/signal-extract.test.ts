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
      { role: "user", text: "First request", messageId: "u1", sessionID: undefined, polluted: false },
      { role: "assistant", text: "First reply", messageId: "a1", sessionID: undefined, polluted: false },
      { role: "user", text: "Second request", messageId: "u2", sessionID: undefined, polluted: false },
    ]);
  });

  it("extracts wrapped user content and flags polluted on slash-command messages", () => {
    const message: Message = {
      id: "u_omo",
      role: "user",
      sessionID: "ses_flow",
      parts: [{ type: "text", text: "<command-instruction>x</command-instruction><user-request>real ask</user-request>" }],
    };

    const [turn] = groupIntoTurns([message]);

    // strip-line behaviour: wrapper inner content survives so the turn
    // still has signal value. `polluted` stays true for observability.
    expect(turn?.text).toBe("real ask");
    expect(turn?.polluted).toBe(true);
    expect(turn?.sessionID).toBe("ses_flow");
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

describe("signal extraction polluted handling", () => {
  it("marks turns from polluted messages with empty text + polluted flag", () => {
    const messages: Message[] = [
      { id: "m_polluted", role: "user", parts: [{ type: "text", text: "<Work_Context>policy</Work_Context>" }] },
      { id: "m_clean", role: "user", parts: [{ type: "text", text: "hello" }] },
    ];

    const turns = groupIntoTurns(messages);
    expect(turns[0]?.polluted).toBe(true);
    expect(turns[0]?.text).toBe("");
    expect(turns[1]?.polluted).toBe(false);
    expect(turns[1]?.text).toBe("hello");
  });

  it("extractSignalContent omits polluted turns from the joined output", () => {
    const messages: Message[] = [
      { id: "u_pol", role: "user", parts: [{ type: "text", text: "<system-reminder>x</system-reminder>" }] },
      { id: "u_sig", role: "user", parts: [{ type: "text", text: "please remember this fact" }] },
      { id: "a_rep", role: "assistant", parts: [{ type: "text", text: "OK noted" }] },
    ];

    const content = extractSignalContent(messages, { signalKeywords: ["remember"], signalTurnsBefore: 5 });
    expect(content).not.toBeNull();
    expect(content).not.toContain("system-reminder");
    expect(content).toContain("please remember this fact");
  });

  describe("word-boundary matching", () => {
    it("matches whole-word keywords (does NOT bleed across word boundaries)", () => {
      // Regression: previously used `.includes()` so "I work" matched
      // inside "I worked all night" and "my team" matched inside
      // "my teammate". Now word-boundary anchors prevent that.
      const turns: Turn[] = [
        { role: "user", text: "I worked all night on this", messageId: "u1" },
        { role: "user", text: "my teammate said hi", messageId: "u2" },
      ];
      expect(findSignalTurns(turns, ["I work", "my team"])).toEqual([]);
    });

    it("still matches the keyword when used as a real whole word", () => {
      const turns: Turn[] = [
        { role: "user", text: "I work at Acme", messageId: "u1" },
        { role: "user", text: "my team uses Bun", messageId: "u2" },
      ];
      expect(findSignalTurns(turns, ["I work", "my team"])).toEqual([0, 1]);
    });

    it("escapes regex metacharacters in user-supplied keywords", () => {
      const turns: Turn[] = [{ role: "user", text: "this is c++ code", messageId: "u1" }];
      // `+` would blow up an unescaped regex; whole-word match still works.
      expect(findSignalTurns(turns, ["c++"])).toEqual([0]);
    });
  });

  describe("code-block stripping before keyword match", () => {
    it("ignores keywords appearing INSIDE fenced code blocks", () => {
      // Regression: pasting a spec/code sample with the word "remember"
      // or "never" inside ```...``` used to trigger capture of the whole
      // surrounding conversation. Now matches the chat keyword path.
      const turns: Turn[] = [
        {
          role: "user",
          text: "here is a sample:\n```\n// never forget to remember\n```\nthoughts?",
          messageId: "u1",
        },
      ];
      expect(findSignalTurns(turns, ["remember"])).toEqual([]);
    });

    it("ignores keywords appearing inside inline code", () => {
      const turns: Turn[] = [{ role: "user", text: "why does `remember()` exist?", messageId: "u1" }];
      expect(findSignalTurns(turns, ["remember"])).toEqual([]);
    });

    it("still matches keywords in prose around code blocks", () => {
      const turns: Turn[] = [{ role: "user", text: "please remember:\n```\nfoo()\n```\nas requested", messageId: "u1" }];
      expect(findSignalTurns(turns, ["remember"])).toEqual([0]);
    });
  });
});
