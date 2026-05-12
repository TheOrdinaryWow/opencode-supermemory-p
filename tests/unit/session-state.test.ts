import { describe, expect, it } from "bun:test";

import { createSessionState } from "../../src/session/state.ts";

describe("createSessionState", () => {
  it("starts empty — wasInjected returns false for any id", () => {
    const state = createSessionState();
    expect(state.wasInjected("ses_anything")).toBe(false);
    expect(state.wasInjected("")).toBe(false);
  });

  it("markInjected makes wasInjected return true for the same id", () => {
    const state = createSessionState();
    state.markInjected("ses_1");
    expect(state.wasInjected("ses_1")).toBe(true);
  });

  it("markInjected is idempotent — calling twice keeps wasInjected true", () => {
    const state = createSessionState();
    state.markInjected("ses_1");
    state.markInjected("ses_1");
    expect(state.wasInjected("ses_1")).toBe(true);
  });

  it("tracks multiple sessions independently", () => {
    const state = createSessionState();
    state.markInjected("ses_a");
    state.markInjected("ses_b");
    expect(state.wasInjected("ses_a")).toBe(true);
    expect(state.wasInjected("ses_b")).toBe(true);
    expect(state.wasInjected("ses_c")).toBe(false);
  });

  it("forget removes an injected session — wasInjected returns false after", () => {
    const state = createSessionState();
    state.markInjected("ses_1");
    expect(state.wasInjected("ses_1")).toBe(true);
    state.forget("ses_1");
    expect(state.wasInjected("ses_1")).toBe(false);
  });

  it("forget on an unknown id is a no-op", () => {
    const state = createSessionState();
    state.forget("ses_never_seen");
    expect(state.wasInjected("ses_never_seen")).toBe(false);
  });

  it("forget only removes the targeted id, leaves others intact", () => {
    const state = createSessionState();
    state.markInjected("ses_a");
    state.markInjected("ses_b");
    state.forget("ses_a");
    expect(state.wasInjected("ses_a")).toBe(false);
    expect(state.wasInjected("ses_b")).toBe(true);
  });

  it("each createSessionState() call yields an isolated tracker", () => {
    const stateA = createSessionState();
    const stateB = createSessionState();
    stateA.markInjected("ses_1");
    expect(stateA.wasInjected("ses_1")).toBe(true);
    expect(stateB.wasInjected("ses_1")).toBe(false);
  });

  it("markInjected then forget then markInjected again works", () => {
    const state = createSessionState();
    state.markInjected("ses_1");
    state.forget("ses_1");
    expect(state.wasInjected("ses_1")).toBe(false);
    state.markInjected("ses_1");
    expect(state.wasInjected("ses_1")).toBe(true);
  });
});
