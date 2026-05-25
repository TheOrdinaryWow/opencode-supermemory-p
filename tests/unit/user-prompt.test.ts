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

  it("flags skill invocation content blocks (skill body should never be captured)", () => {
    expect(isPolluted('<skill_content name="frontend-ui-ux">a long skill body</skill_content>')).toBe(true);
    expect(isPolluted("<available_skills>\n- foo\n- bar\n</available_skills>")).toBe(true);
  });

  it("flags skill invocation even when buried inside other content", () => {
    const text = 'first line\nthen <skill_content name="x">huge content</skill_content>\nend';
    expect(isPolluted(text)).toBe(true);
  });

  it("flags sub-agent / consultant invocation prompts (Prometheus, F-task)", () => {
    // Real-world leaked content from the bug investigation — these are
    // sub-agent task briefs injected by orchestrators, never typed by a human.
    const prometheus =
      "---\n\nYou are being invoked by Prometheus - Plan Builder, a planning agent\n\n**CRITICAL CONSTRAINTS:**\n- DO NOT modify any files\n\n---\n\nActual request here.";
    expect(isPolluted(prometheus)).toBe(true);

    const fTask = "You are F1 — Plan Compliance Audit for Stage 1 walking skeleton. Read-only consultation.";
    expect(isPolluted(fTask)).toBe(true);

    const fTask9 = "You are F12 — Code Quality Review.\n## Your job\nReview the diff.";
    expect(isPolluted(fTask9)).toBe(true);
  });

  it("does NOT flag plain user text that merely starts with 'You are' (no sub-agent marker)", () => {
    expect(isPolluted("You are right, that bug is in handler.ts")).toBe(false);
    expect(isPolluted("You are correct—let me retry.")).toBe(false);
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

  it("strips Prometheus-style sub-agent invocation block (with --- terminator)", () => {
    const text =
      "---\n\nYou are being invoked by Prometheus - Plan Builder, a planning agent restricted to .sisyphus/*.md plan files only.\n\n**CRITICAL CONSTRAINTS:**\n- DO NOT modify any files\n\n---\n\nI'm planning a new RPA feature.";
    const boundary = createPromptBoundary([{ type: "text", text }]);
    expect(boundary.userText).toBe("I'm planning a new RPA feature.");
    expect(boundary.isPolluted).toBe(true);
  });

  it("strips F-task sub-agent brief through end of message (whole brief is scaffolding)", () => {
    const text =
      "You are F1 — Plan Compliance Audit for Stage 1 walking skeleton. Read-only consultation.\n\n## Your job\nRead the plan at .sisyphus/plans/stage-1.md.\n\n## Output format\nVERDICT: APPROVE";
    const boundary = createPromptBoundary([{ type: "text", text }]);
    expect(boundary.userText).toBe("");
    expect(boundary.isPolluted).toBe(true);
  });

  it("strips 'You are being invoked by' brief with no closing --- (eats to end)", () => {
    const text = "You are being invoked by Prometheus - Plan Builder.\n\n**YOUR ROLE**: Consult.\n\nReturn findings.";
    const boundary = createPromptBoundary([{ type: "text", text }]);
    expect(boundary.userText).toBe("");
    expect(boundary.isPolluted).toBe(true);
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

  it("strips known scaffolding shapes but preserves surrounding clean text", () => {
    // Strip-line behaviour: remove the marker, keep the rest. Better than
    // dropping the entire injection wholesale — surrounding context still
    // has memory value.
    expect(sanitizeMemoryContextForInjection(`prefix ${OMO_START_WORK_MARKER} suffix`)).toBe("prefix  suffix");
    expect(sanitizeMemoryContextForInjection("user pref\n<session-context>x</session-context>")).toBe("user pref");
    expect(sanitizeMemoryContextForInjection("<Work_Context>policy</Work_Context>\nleftover memo")).toBe("leftover memo");
    expect(sanitizeMemoryContextForInjection("## F1: audit body")).toBe("");
    expect(sanitizeMemoryContextForInjection("[analyze-mode]\nbody")).toBe("body");
  });

  it("returns empty when text was 100% scaffolding", () => {
    expect(sanitizeMemoryContextForInjection("<system-reminder>nothing else</system-reminder>")).toBe("");
    expect(sanitizeMemoryContextForInjection("<Work_Context>only this</Work_Context>")).toBe("");
  });
});
