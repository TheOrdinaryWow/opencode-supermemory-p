import { describe, expect, it } from "bun:test";

import { createPromptBoundary, isPolluted, sanitizeMemoryContextForInjection, type TextPartLike } from "@/shared/user-prompt";

const OMO_START_WORK_MARKER = "You are starting a Sisyphus work session.";

describe("isPolluted", () => {
  it("returns false for empty / undefined input", () => {
    expect(isPolluted("")).toBe(false);
    expect(isPolluted(undefined)).toBe(false);
    expect(isPolluted(null)).toBe(false);
  });

  it("returns false for plain user text", () => {
    expect(isPolluted("hello world, please refactor auth.ts")).toBe(false);
    expect(isPolluted("we use TanStack Query for data fetching")).toBe(false);
  });

  it("flags every OMO / plugin block-wrapper opening tag", () => {
    expect(isPolluted("<auto-slash-command>x")).toBe(true);
    expect(isPolluted("<command-instruction>x")).toBe(true);
    expect(isPolluted("<session-context>x")).toBe(true);
    expect(isPolluted("<system-reminder>x")).toBe(true);
    expect(isPolluted("<supermemory-context>x")).toBe(true);
    expect(isPolluted("<user-request>x</user-request>")).toBe(true);
    expect(isPolluted("<user-task>x</user-task>")).toBe(true);
  });

  it("flags Sisyphus <Work_Context> wrapper", () => {
    expect(isPolluted("<Work_Context>x</Work_Context>")).toBe(true);
  });

  it("flags Sisyphus task brief headers (## F1: through ## F9:)", () => {
    expect(isPolluted("## F1: Plan Compliance Audit")).toBe(true);
    expect(isPolluted("## F2: Code Quality Review")).toBe(true);
    expect(isPolluted("  ## F9: edge case")).toBe(true);
  });

  it("flags Sisyphus plan-management markers", () => {
    expect(isPolluted("## Auto-Selected Plan")).toBe(true);
    expect(isPolluted("## Plan Not Found")).toBe(true);
    expect(isPolluted("boulder.json has been created. Read the plan.")).toBe(true);
  });

  it("flags Sisyphus mode indicators on their own line", () => {
    expect(isPolluted("[analyze-mode]")).toBe(true);
    expect(isPolluted("[search-mode]")).toBe(true);
    expect(isPolluted("[deep-mode]")).toBe(true);
    expect(isPolluted("[ultrawork-mode]")).toBe(true);
    expect(isPolluted("[visual-engineering-mode]")).toBe(true);
  });

  it("flags system directives and recovery prompts", () => {
    expect(isPolluted("[SYSTEM DIRECTIVE: OH-MY-OPENCODE - X]")).toBe(true);
    expect(isPolluted("[restore checkpointed session agent configuration after compaction]")).toBe(true);
    expect(isPolluted("<!-- OMO_INTERNAL_INITIATOR -->")).toBe(true);
  });

  it("flags standalone scaffolding signature strings", () => {
    expect(isPolluted(OMO_START_WORK_MARKER)).toBe(true);
    expect(isPolluted("MANDATORY delegate_task params: ALWAYS include load_skills=[]")).toBe(true);
  });

  it("flags polluted message even when buried mid-text", () => {
    expect(isPolluted("user said: hi\n<system-reminder>noise</system-reminder>\nmore text")).toBe(true);
  });
});

describe("createPromptBoundary", () => {
  it("returns frozen, empty boundary for missing or all-filtered parts", () => {
    const a = createPromptBoundary(undefined);
    expect(a.rawText).toBe("");
    expect(a.userText).toBe("");
    expect(a.isPolluted).toBe(false);
    expect(Object.isFrozen(a)).toBe(true);

    const b = createPromptBoundary([{ type: "text", text: "x", synthetic: true }]);
    expect(b.rawText).toBe("");
    expect(b.userText).toBe("");
    expect(b.isPolluted).toBe(false);
  });

  it("filters synthetic + ignored + non-text parts before joining", () => {
    const parts: TextPartLike[] = [
      { type: "text", text: "from supermemory injection", synthetic: true },
      { type: "tool", text: "tool output" },
      { type: "text", text: "ignored fragment", ignored: true },
      { type: "text", text: "real user input" },
    ];
    const boundary = createPromptBoundary(parts);
    expect(boundary.rawText).toBe("real user input");
    expect(boundary.userText).toBe("real user input");
    expect(boundary.isPolluted).toBe(false);
  });

  it("returns raw text trimmed when no wrappers are present", () => {
    const boundary = createPromptBoundary([{ type: "text", text: "  hello world  " }]);
    expect(boundary.userText).toBe("hello world");
  });

  it("extracts <user-request> body and marks polluted (slash-command path)", () => {
    const expansion = `<command-instruction>${OMO_START_WORK_MARKER}</command-instruction>\n<user-request>refactor auth.ts</user-request>`;
    const boundary = createPromptBoundary([{ type: "text", text: expansion }]);

    expect(boundary.userText).toBe("refactor auth.ts");
    // Even though we extract the body for query use, the message itself is
    // still polluted — capture-path callers must skip it.
    expect(boundary.isPolluted).toBe(true);
  });

  it("extracts <user-task> body and marks polluted", () => {
    const expansion = "<command-instruction>x</command-instruction>\n<user-task>fix the failing test</user-task>";
    const boundary = createPromptBoundary([{ type: "text", text: expansion }]);
    expect(boundary.userText).toBe("fix the failing test");
    expect(boundary.isPolluted).toBe(true);
  });

  it("joins multiple user wrappers in order", () => {
    const raw = "<user-request>one</user-request>\nmid noise\n<user-task>two</user-task>";
    const boundary = createPromptBoundary([{ type: "text", text: raw }]);
    expect(boundary.userText).toBe("one\ntwo");
  });

  it("attaches sessionID and role from context", () => {
    const boundary = createPromptBoundary([{ type: "text", text: "x" }], { sessionID: "ses_1", role: "user" });
    expect(boundary.sessionID).toBe("ses_1");
    expect(boundary.role).toBe("user");
  });

  it("plain user prompt is non-polluted (capture allowed)", () => {
    const boundary = createPromptBoundary([{ type: "text", text: "remember that we use Bun" }]);
    expect(boundary.isPolluted).toBe(false);
  });

  it("polluted messages with non-wrapper content keep userText = raw text (debug/log usable)", () => {
    const polluted = "<system-reminder>do x</system-reminder>\nfollow-up";
    const boundary = createPromptBoundary([{ type: "text", text: polluted }]);
    expect(boundary.isPolluted).toBe(true);
    // No user-wrapper present, so userText is the raw trimmed text. The
    // important guarantee is `isPolluted: true` — capture callers will skip.
    expect(boundary.userText).toContain("follow-up");
  });
});

describe("sanitizeMemoryContextForInjection", () => {
  it("returns empty string for empty input", () => {
    expect(sanitizeMemoryContextForInjection("")).toBe("");
  });

  it("passes clean memory text through unchanged", () => {
    const clean = "[SUPERMEMORY]\n\nUser Profile:\n- Prefers Bun\n\nProject Knowledge:\n- Uses TanStack Query";
    expect(sanitizeMemoryContextForInjection(clean)).toBe(clean);
  });

  it("returns empty string when memory text contains ANY pollution marker", () => {
    // The point: legacy memories captured before pollution filtering may
    // contain markers. Rather than partially strip them (fragile), we drop
    // the whole injection. Better no context than markers that re-trigger
    // downstream plugins.
    expect(sanitizeMemoryContextForInjection(`prefix ${OMO_START_WORK_MARKER} suffix`)).toBe("");
    expect(sanitizeMemoryContextForInjection("user pref\n<session-context>x</session-context>")).toBe("");
    expect(sanitizeMemoryContextForInjection("## F1: audit body")).toBe("");
    expect(sanitizeMemoryContextForInjection("[analyze-mode]\nbody")).toBe("");
    expect(sanitizeMemoryContextForInjection("<Work_Context>policy</Work_Context>")).toBe("");
  });
});
