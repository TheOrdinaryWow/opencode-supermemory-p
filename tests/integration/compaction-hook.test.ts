import { describe, expect, it } from "bun:test";

import { type CompactionContext, createCompactionHook } from "../../src/compaction/index.ts";

function createCtx(): CompactionContext {
  return {
    directory: "/tmp/test-compaction",
    client: {
      session: {
        summarize: async () => undefined,
        messages: async () => ({ data: [] }),
        promptAsync: async () => undefined,
      },
      tui: {
        showToast: async () => undefined,
      },
    },
  };
}

const tags = { user: "test-user", project: "test-project" };

describe("compaction hook events", () => {
  it("handles session.deleted without throwing", async () => {
    const hook = createCompactionHook(createCtx(), tags);

    const result = await hook.event({ event: { type: "session.deleted", properties: { info: { id: "ses_1" } } } });

    expect(result).toBeUndefined();
  });

  it("handles message.updated without throwing", async () => {
    const hook = createCompactionHook(createCtx(), tags);

    const result = await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: { id: "msg_1", role: "assistant", sessionID: "ses_1", finish: true },
        },
      },
    });

    expect(result).toBeUndefined();
  });

  it("handles session.idle without throwing", async () => {
    const hook = createCompactionHook(createCtx(), tags);

    const result = await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses_1" } } });

    expect(result).toBeUndefined();
  });
});
