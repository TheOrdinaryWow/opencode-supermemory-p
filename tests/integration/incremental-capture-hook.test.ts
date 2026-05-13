import { describe, expect, it, mock } from "bun:test";

import type { IncrementalCaptureDeps } from "@/capture/incremental";
import { DEFAULTS } from "@/config/defaults";
import { SupermemoryConfigSchema } from "@/config/schema";
import { handleEvent } from "@/events/handler";

async function flushCaptureQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("incremental capture event hook", () => {
  it("dispatches only completed assistant message.updated events", async () => {
    const addMemory = mock(async (_content: string, _containerTag: string, _metadata?: { type: string; source?: string }) => ({
      success: true as const,
      id: "mem_1",
    }));
    const deps = {
      config: SupermemoryConfigSchema.parse({ ...DEFAULTS, projectContainerTag: "project-tag", signalExtraction: false }),
      client: { addMemory } as unknown as IncrementalCaptureDeps["client"],
      tracker: {
        getLastCaptured: mock(async () => null),
        appendCaptured: mock(async () => undefined),
        pruneOldTrackers: mock(async () => 0),
      },
      signalExtract: mock(() => "captured"),
      dataDir: "/tmp/project",
    } satisfies IncrementalCaptureDeps;

    await handleEvent(
      {
        event: {
          type: "message.updated",
          properties: {
            info: {
              id: "msg_1",
              sessionID: "ses_1",
              role: "assistant",
              finish: true,
              parts: [{ type: "text", text: "capture this" }],
            },
          },
        },
      },
      { compactionHook: null, incrementalCapture: deps },
    );
    await flushCaptureQueue();

    await handleEvent(
      {
        event: {
          type: "message.part.updated",
          properties: {
            info: {
              id: "msg_2",
              sessionID: "ses_1",
              role: "assistant",
              finish: true,
              parts: [{ type: "text", text: "stream delta" }],
            },
          },
        },
      },
      { compactionHook: null, incrementalCapture: deps },
    );
    await flushCaptureQueue();

    expect(addMemory).toHaveBeenCalledTimes(1);
    expect(addMemory.mock.calls[0]?.[0]).toBe("capture this");
  });
});
