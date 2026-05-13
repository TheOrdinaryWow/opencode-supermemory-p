import { describe, expect, it } from "bun:test";

import {
  createPromptBoundary,
  extractUserPrompt,
  extractUserPromptFromParts,
  sanitizeMemoryContextForInjection,
  type TextPartLike,
} from "@/shared/user-prompt";

const OMO_START_WORK_MARKER = "You are starting a Sisyphus work session.";

describe("createPromptBoundary", () => {
  it("carries rawText (joined eligible parts) alongside userText", () => {
    const parts: TextPartLike[] = [{ type: "text", text: "hello world" }];
    const boundary = createPromptBoundary(parts);
    expect(boundary.rawText).toBe("hello world");
    expect(boundary.userText).toBe("hello world");
    expect(boundary.source).toBe("raw-text");
  });

  it("attaches sessionID and role from context", () => {
    const boundary = createPromptBoundary([{ type: "text", text: "x" }], {
      sessionID: "ses_1",
      role: "user",
    });
    expect(boundary.sessionID).toBe("ses_1");
    expect(boundary.role).toBe("user");
  });

  it("rawText preserves OMO wrapper while userText extracts inner content", () => {
    const omoExpansion = `<command-instruction>${OMO_START_WORK_MARKER}</command-instruction>\n<user-request>real ask</user-request>`;
    const boundary = createPromptBoundary([{ type: "text", text: omoExpansion }]);
    expect(boundary.rawText).toBe(omoExpansion);
    expect(boundary.userText).toBe("real ask");
    expect(boundary.source).toBe("wrapped-user-content");
  });

  it("returns empty boundary for empty parts", () => {
    const boundary = createPromptBoundary([]);
    expect(boundary.userText).toBe("");
    expect(boundary.rawText).toBe("");
    expect(boundary.source).toBe("empty");
  });

  it("excludes synthetic parts from rawText (those are NOT user input)", () => {
    const parts: TextPartLike[] = [
      { type: "text", text: "<supermemory-context>memory</supermemory-context>", synthetic: true },
      { type: "text", text: "real input" },
    ];
    const boundary = createPromptBoundary(parts);
    expect(boundary.rawText).toBe("real input");
    expect(boundary.userText).toBe("real input");
  });

  it("is frozen (immutable)", () => {
    const boundary = createPromptBoundary([{ type: "text", text: "x" }]);
    expect(Object.isFrozen(boundary)).toBe(true);
  });

  it("undefined parts produces empty boundary with context still attached", () => {
    const boundary = createPromptBoundary(undefined, { sessionID: "ses_x", role: "assistant" });
    expect(boundary.userText).toBe("");
    expect(boundary.rawText).toBe("");
    expect(boundary.sessionID).toBe("ses_x");
    expect(boundary.role).toBe("assistant");
  });
});

describe("extractUserPrompt", () => {
  it("returns wrapped content from <user-request>", () => {
    const raw = `<command-instruction>
${OMO_START_WORK_MARKER}
Do work.
</command-instruction>

<session-context>
Session ID: ses_abc
Timestamp: 2026-05-14T00:00:00Z
</session-context>

<user-request>
help me refactor auth.ts
</user-request>`;

    const result = extractUserPrompt(raw);
    expect(result.text).toBe("help me refactor auth.ts");
    expect(result.source).toBe("wrapped-user-content");
  });

  it("returns wrapped content from <user-task>", () => {
    const raw = `<command-instruction>
Do something
</command-instruction>

<user-task>
fix the failing test
</user-task>`;

    const result = extractUserPrompt(raw);
    expect(result.text).toBe("fix the failing test");
    expect(result.source).toBe("wrapped-user-content");
  });

  it("joins multiple user wrappers in order", () => {
    const raw = `<user-request>
first request
</user-request>

mid noise

<user-task>
second request
</user-task>`;

    const result = extractUserPrompt(raw);
    expect(result.text).toBe("first request\nsecond request");
    expect(result.source).toBe("wrapped-user-content");
  });

  it("returns empty when wrapper is empty", () => {
    const raw = `<command-instruction>stuff</command-instruction>
<user-request></user-request>`;

    const result = extractUserPrompt(raw);
    expect(result.text).toBe("");
    expect(result.source).toBe("empty");
  });

  it("returns plain user prompt unchanged", () => {
    const raw = "just a normal question about typescript generics";
    const result = extractUserPrompt(raw);
    expect(result.text).toBe(raw);
    expect(result.source).toBe("raw-text");
  });

  it("strips <system-reminder> when no user wrapper present", () => {
    const raw = `<system-reminder>
[SYSTEM DIRECTIVE: OH-MY-OPENCODE - SINGLE TASK ONLY]
some reminder body
</system-reminder>`;

    const result = extractUserPrompt(raw);
    expect(result.text).toBe("");
    expect(result.source).toBe("empty");
    expect(result.strippedMarkers).toContain("system-reminder");
  });

  it("strips [SYSTEM DIRECTIVE: ...] prefix lines", () => {
    const raw = `[SYSTEM DIRECTIVE: OH-MY-OPENCODE - BOULDER CONTINUATION]

You have an active work plan with incomplete tasks.
keep working.`;

    const result = extractUserPrompt(raw);
    expect(result.text).toContain("You have an active work plan");
    expect(result.text).not.toContain("[SYSTEM DIRECTIVE");
    expect(result.source).toBe("sanitized-text");
  });

  it("strips OMO checkpoint restore prompt", () => {
    const raw = `[restore checkpointed session agent configuration after compaction]
<!-- OMO_INTERNAL_INITIATOR -->`;

    const result = extractUserPrompt(raw);
    expect(result.text).toBe("");
    expect(result.source).toBe("empty");
  });

  it("prefers <user-request> over <command-instruction>", () => {
    const raw = `<command-instruction>
${OMO_START_WORK_MARKER}
</command-instruction>

<user-request>
the actual prompt
</user-request>`;

    const result = extractUserPrompt(raw);
    expect(result.text).toBe("the actual prompt");
    expect(result.source).toBe("wrapped-user-content");
  });

  it("preserves <session-context> inside code fence", () => {
    const raw = `here is the OMO template:

\`\`\`xml
<session-context>
Session ID: $SESSION_ID
</session-context>
\`\`\`

please explain how this works`;

    const result = extractUserPrompt(raw);
    expect(result.text).toContain("<session-context>");
    expect(result.text).toContain("please explain how this works");
  });

  it("preserves prose + code fence, strips real injected block", () => {
    const raw = `<system-reminder>
ignore me
</system-reminder>

here is some code:

\`\`\`ts
const x = "<user-request>not real</user-request>";
\`\`\`

end of message`;

    const result = extractUserPrompt(raw);
    expect(result.text).toContain("here is some code");
    expect(result.text).toContain("end of message");
    expect(result.text).toContain('const x = "<user-request>not real</user-request>"');
    expect(result.text).not.toContain("ignore me");
  });

  it("strips <supermemory-context> wrappers from prior injections", () => {
    const raw = `<supermemory-context>
[SUPERMEMORY]
User Profile:
- Likes brevity
</supermemory-context>

actual user message`;

    const result = extractUserPrompt(raw);
    expect(result.text).toBe("actual user message");
    expect(result.source).toBe("sanitized-text");
  });

  it("handles malformed tags conservatively (no catastrophic deletion)", () => {
    const raw = `<user-request>
no closing tag, this should still work

normal text after`;

    const result = extractUserPrompt(raw);
    // unclosed wrapper falls back to denylist sanitize; user content preserved
    expect(result.text).toContain("no closing tag");
    expect(result.text).toContain("normal text after");
  });

  it("processes ~70KB input quickly and bounds output", () => {
    const filler = "lorem ipsum ".repeat(7000); // ~84KB
    const raw = `<system-reminder>${filler}</system-reminder>

<user-request>
real ask
</user-request>`;

    const start = Date.now();
    const result = extractUserPrompt(raw);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(result.text).toBe("real ask");
    expect(result.source).toBe("wrapped-user-content");
  });
});

describe("extractUserPromptFromParts", () => {
  it("skips synthetic parts", () => {
    const parts: TextPartLike[] = [
      { type: "text", text: "from supermemory injection", synthetic: true },
      { type: "text", text: "actual user input" },
    ];

    const result = extractUserPromptFromParts(parts);
    expect(result.text).toBe("actual user input");
  });

  it("skips ignored parts", () => {
    const parts: TextPartLike[] = [
      { type: "text", text: "irrelevant", ignored: true },
      { type: "text", text: "this is the real one" },
    ];

    const result = extractUserPromptFromParts(parts);
    expect(result.text).toBe("this is the real one");
  });

  it("ignores non-text parts", () => {
    const parts: TextPartLike[] = [
      { type: "tool", text: "tool output" },
      { type: "text", text: "user text" },
    ];

    const result = extractUserPromptFromParts(parts);
    expect(result.text).toBe("user text");
  });

  it("joins multiple eligible parts and extracts wrappers across them", () => {
    const parts: TextPartLike[] = [
      { type: "text", text: "<command-instruction>cmd</command-instruction>" },
      { type: "text", text: "<user-request>real prompt</user-request>" },
    ];

    const result = extractUserPromptFromParts(parts);
    expect(result.text).toBe("real prompt");
  });

  it("returns empty when all parts filtered or empty", () => {
    const parts: TextPartLike[] = [
      { type: "text", text: "synthetic data", synthetic: true },
      { type: "text", text: "", synthetic: false },
    ];

    const result = extractUserPromptFromParts(parts);
    expect(result.text).toBe("");
    expect(result.source).toBe("empty");
  });

  it("handles undefined parts list", () => {
    const result = extractUserPromptFromParts(undefined);
    expect(result.text).toBe("");
    expect(result.source).toBe("empty");
  });
});

describe("sanitizeMemoryContextForInjection", () => {
  it("removes both OMO start-work-hook trigger markers", () => {
    const polluted = `[SUPERMEMORY]
Project Knowledge:
- [100%] Past session contained:
  ${OMO_START_WORK_MARKER}
  <session-context>Session ID: foo</session-context>`;

    const safe = sanitizeMemoryContextForInjection(polluted);

    expect(safe.includes("<session-context>") && safe.includes(OMO_START_WORK_MARKER)).toBe(false);
  });

  it("removes <command-instruction> blocks", () => {
    const polluted = `User Profile:
- pref: be concise

<command-instruction>
You are starting a Sisyphus work session.
</command-instruction>`;

    const safe = sanitizeMemoryContextForInjection(polluted);

    expect(safe).not.toContain("<command-instruction>");
    expect(safe).not.toContain("</command-instruction>");
    expect(safe).toContain("be concise");
  });

  it("removes <auto-slash-command> blocks", () => {
    const polluted = `<auto-slash-command>
# /start-work Command
${OMO_START_WORK_MARKER}
</auto-slash-command>

normal memo`;

    const safe = sanitizeMemoryContextForInjection(polluted);

    expect(safe).not.toContain("<auto-slash-command>");
    expect(safe).not.toContain(OMO_START_WORK_MARKER);
    expect(safe).toContain("normal memo");
  });

  it("preserves legitimate content outside injection markers", () => {
    const polluted = `User Profile:
- Likes typescript
- Project: opencode-supermemory-p
- Build: bun run build`;

    const safe = sanitizeMemoryContextForInjection(polluted);

    expect(safe).toContain("Likes typescript");
    expect(safe).toContain("Project: opencode-supermemory-p");
    expect(safe).toContain("Build: bun run build");
  });

  it("removes SYSTEM DIRECTIVE prefix lines from memory text", () => {
    const polluted = `Project memo:
[SYSTEM DIRECTIVE: OH-MY-OPENCODE - BOULDER CONTINUATION]
- task remaining: x`;

    const safe = sanitizeMemoryContextForInjection(polluted);
    expect(safe).not.toContain("[SYSTEM DIRECTIVE");
    expect(safe).toContain("task remaining: x");
  });

  it("neutralizes lone marker strings even outside tags", () => {
    const polluted = `Past summary: ${OMO_START_WORK_MARKER} ran successfully`;

    const safe = sanitizeMemoryContextForInjection(polluted);
    expect(safe).not.toContain(OMO_START_WORK_MARKER);
  });
});
