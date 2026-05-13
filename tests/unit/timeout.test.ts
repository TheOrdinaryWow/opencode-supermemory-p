import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { advanceTime, useFakeTimers, useRealTimers } from "../helpers/mock-time";

describe("withTimeout", () => {
  beforeEach(() => {
    useFakeTimers();
  });

  afterEach(() => {
    useRealTimers();
  });

  it("resolves with the wrapped value before the timeout", async () => {
    const { withTimeout } = await import("../../src/shared/timeout");

    const result = await withTimeout(Promise.resolve("ok"), 1000);
    advanceTime(0);

    expect(result).toBe("ok");
  });

  it("rejects after the timeout with the backward-compatible message", async () => {
    const { withTimeout } = await import("../../src/shared/timeout");

    const result = withTimeout(new Promise<string>(() => {}), 50);
    advanceTime(50);

    try {
      await result;
      throw new Error("expected timeout error");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      if (!(error instanceof Error)) throw error;
      expect(error.message).toBe("Timeout after 50ms");
    }
  });

  it("includes the label in the timeout message when provided", async () => {
    const { withTimeout } = await import("../../src/shared/timeout");

    const result = withTimeout(new Promise<string>(() => {}), 25, "fetch");
    advanceTime(25);

    try {
      await result;
      throw new Error("expected timeout error");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      if (!(error instanceof Error)) throw error;
      expect(error.message).toBe("Timeout after 25ms (fetch)");
    }
  });

  it("clears the timeout handle after resolve", async () => {
    const { withTimeout } = await import("../../src/shared/timeout");
    const clearTimeoutSpy = spyOn(globalThis, "clearTimeout");

    const result = await withTimeout(Promise.resolve(123), 1000);
    advanceTime(0);

    expect(result).toBe(123);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});
