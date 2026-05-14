import { describe, expect, it } from "bun:test";

import { createIgnoredToastEmitter, IGNORED_TOAST_MESSAGE } from "@/ui/ignored-toast";

type ToastBody = { title: string; message: string; variant: string; duration: number };

function makeRecorder() {
  const calls: ToastBody[] = [];
  const client = {
    showToast: async (params: { body: ToastBody }) => {
      calls.push(params.body);
      return { ok: true };
    },
  };
  return { client, calls };
}

const noopLog = () => {};

describe("createIgnoredToastEmitter", () => {
  it("emits a toast with the correct title and message on first call", async () => {
    const { client, calls } = makeRecorder();
    const emit = createIgnoredToastEmitter({ client, version: "9.9.9", log: noopLog });

    await emit();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.title).toBe("opencode-supermemory-p 9.9.9");
    expect(calls[0]?.message).toBe(IGNORED_TOAST_MESSAGE);
    expect(calls[0]?.variant).toBe("info");
    expect(typeof calls[0]?.duration).toBe("number");
  });

  it("only emits once across many invocations", async () => {
    const { client, calls } = makeRecorder();
    const emit = createIgnoredToastEmitter({ client, version: "1.0.0", log: noopLog });

    await emit();
    await emit();
    await emit();

    expect(calls).toHaveLength(1);
  });

  it("is a no-op when the TUI client is undefined", async () => {
    const emit = createIgnoredToastEmitter({ client: undefined, version: "1.0.0", log: noopLog });
    await expect(emit()).resolves.toBeUndefined();
  });

  it("swallows showToast errors and reports via the provided logger", async () => {
    const logged: Array<{ message: string; data?: unknown }> = [];
    const client = {
      showToast: async () => {
        throw new Error("boom");
      },
    };
    const emit = createIgnoredToastEmitter({
      client,
      version: "1.0.0",
      log: (message, data) => {
        logged.push({ message, data });
      },
    });

    await expect(emit()).resolves.toBeUndefined();
    expect(logged.length).toBeGreaterThan(0);
    expect(logged[0]?.message).toMatch(/supermemoryignore toast/i);
  });

  it("does not retry after a failure (still one-shot semantics)", async () => {
    let attempts = 0;
    const client = {
      showToast: async () => {
        attempts += 1;
        throw new Error("network down");
      },
    };
    const emit = createIgnoredToastEmitter({ client, version: "1.0.0", log: noopLog });

    await emit();
    await emit();
    await emit();

    expect(attempts).toBe(1);
  });
});
