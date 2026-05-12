import { describe, expect, it } from "bun:test";

import { handleEvent } from "../../src/events/handler.ts";

interface RecordedCall {
  event: { type: string; properties?: unknown };
}

function makeHook() {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async event(input: { event: { type: string; properties?: unknown } }) {
      calls.push(input);
    },
  };
}

describe("handleEvent", () => {
  it("delegates to compactionHook.event when configured", async () => {
    const hook = makeHook();
    const input = { event: { type: "session.idle", properties: { sessionID: "ses_1" } } };

    await handleEvent(input, { compactionHook: hook });

    expect(hook.calls).toHaveLength(1);
    expect(hook.calls[0]).toBe(input);
  });

  it("passes through event payloads byte-identical", async () => {
    const hook = makeHook();
    const input = { event: { type: "chat.compacted", properties: { count: 7, foo: "bar" } } };

    await handleEvent(input, { compactionHook: hook });

    expect(hook.calls[0]?.event.type).toBe("chat.compacted");
    expect(hook.calls[0]?.event.properties).toEqual({ count: 7, foo: "bar" });
  });

  it("is a no-op when compactionHook is null", async () => {
    const input = { event: { type: "session.created" } };

    await expect(handleEvent(input, { compactionHook: null })).resolves.toBeUndefined();
  });

  it("awaits the delegated hook (propagates the promise)", async () => {
    let resolved = false;
    const hook = {
      async event(_input: unknown): Promise<void> {
        await new Promise((r) => setTimeout(r, 10));
        resolved = true;
      },
    };

    await handleEvent({ event: { type: "x" } }, { compactionHook: hook });

    expect(resolved).toBe(true);
  });

  it("propagates errors thrown by the hook", async () => {
    const hook = {
      async event(_input: unknown): Promise<void> {
        throw new Error("compaction failed");
      },
    };

    await expect(handleEvent({ event: { type: "x" } }, { compactionHook: hook })).rejects.toThrow("compaction failed");
  });

  it("handles events without properties", async () => {
    const hook = makeHook();
    const input = { event: { type: "tick" } };

    await handleEvent(input, { compactionHook: hook });

    expect(hook.calls).toHaveLength(1);
    expect(hook.calls[0]?.event.properties).toBeUndefined();
  });
});
