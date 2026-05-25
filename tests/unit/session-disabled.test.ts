import { afterEach, describe, expect, it } from "bun:test";

import { isSessionDisabled, resetDisabledSessions, updateSessionDisabledFromText } from "@/session/disabled";
import { createPromptBoundary } from "@/shared/user-prompt";

describe("per-session opt-out", () => {
  afterEach(() => resetDisabledSessions());

  it("isSessionDisabled returns false by default", () => {
    expect(isSessionDisabled("ses_1")).toBe(false);
    expect(isSessionDisabled(undefined)).toBe(false);
  });

  it("<supermemory:off /> marker disables the session", () => {
    const after = updateSessionDisabledFromText("ses_a", "please pause memory now <supermemory:off />");
    expect(after).toBe(true);
    expect(isSessionDisabled("ses_a")).toBe(true);
  });

  it("<supermemory:on /> marker re-enables", () => {
    updateSessionDisabledFromText("ses_b", "<supermemory:off />");
    expect(isSessionDisabled("ses_b")).toBe(true);
    updateSessionDisabledFromText("ses_b", "ok resume <supermemory:on />");
    expect(isSessionDisabled("ses_b")).toBe(false);
  });

  it("on wins over off when both appear in the same message", () => {
    updateSessionDisabledFromText("ses_c", "<supermemory:off /> then I changed my mind <supermemory:on />");
    expect(isSessionDisabled("ses_c")).toBe(false);
  });

  it("self-closing variants both recognized (`<…off>` and `<…off/>`)", () => {
    updateSessionDisabledFromText("ses_d", "<supermemory:off>");
    expect(isSessionDisabled("ses_d")).toBe(true);
    updateSessionDisabledFromText("ses_d", "<supermemory:on/>");
    expect(isSessionDisabled("ses_d")).toBe(false);
  });

  it("scope is per-sessionID; one session disabling does not affect another", () => {
    updateSessionDisabledFromText("ses_x", "<supermemory:off />");
    expect(isSessionDisabled("ses_x")).toBe(true);
    expect(isSessionDisabled("ses_y")).toBe(false);
  });

  it("markers are stripped from userText so the assistant never sees them", () => {
    const boundary = createPromptBoundary([{ type: "text", text: "tell me about Bun <supermemory:off /> and also React" }]);
    expect(boundary.userText).not.toContain("supermemory:off");
    expect(boundary.userText).toContain("tell me about Bun");
    expect(boundary.userText).toContain("React");
  });

  it("empty / missing input is a no-op", () => {
    expect(updateSessionDisabledFromText("", "<supermemory:off />")).toBe(false);
    expect(updateSessionDisabledFromText("ses_e", "")).toBe(false);
  });
});
