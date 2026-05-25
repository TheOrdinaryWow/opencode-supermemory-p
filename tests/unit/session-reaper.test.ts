import { afterEach, describe, expect, it } from "bun:test";

import { reapSession, registerSessionCleaner, resetSessionReaper } from "@/session/reaper";

describe("session reaper", () => {
  afterEach(() => {
    resetSessionReaper();
  });

  it("invokes every registered cleaner on reapSession", () => {
    const seen: string[] = [];
    registerSessionCleaner((id) => seen.push(`A:${id}`));
    registerSessionCleaner((id) => seen.push(`B:${id}`));

    reapSession("ses_1");

    expect(seen).toEqual(["A:ses_1", "B:ses_1"]);
  });

  it("isolates a throwing cleaner — other cleaners still run", () => {
    const seen: string[] = [];
    registerSessionCleaner(() => {
      throw new Error("boom");
    });
    registerSessionCleaner((id) => seen.push(id));

    reapSession("ses_2");

    expect(seen).toEqual(["ses_2"]);
  });

  it("unregister handle removes the cleaner", () => {
    const seen: string[] = [];
    const unregister = registerSessionCleaner((id) => seen.push(id));

    reapSession("ses_3");
    unregister();
    reapSession("ses_4");

    expect(seen).toEqual(["ses_3"]);
  });

  it("no-ops gracefully when no cleaners are registered", () => {
    expect(() => reapSession("ses_5")).not.toThrow();
  });
});
