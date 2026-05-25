import { afterEach, describe, expect, it, mock } from "bun:test";

import {
  type EventMessageUpdated,
  handleMessageUpdatedForCapture,
  type IncrementalCaptureDeps,
  resetIncrementalCaptureState,
} from "@/capture/incremental";
import { DEFAULTS } from "@/config/defaults";
import { type SupermemoryConfig, SupermemoryConfigSchema } from "@/config/schema";

function makeConfig(overrides: Partial<SupermemoryConfig> = {}): SupermemoryConfig {
  return SupermemoryConfigSchema.parse({
    ...DEFAULTS,
    ...overrides,
  });
}

type MessageUpdatedInfo = NonNullable<NonNullable<EventMessageUpdated["event"]["properties"]>["info"]>;

function makeEvent(overrides: Partial<MessageUpdatedInfo> = {}): EventMessageUpdated {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_1",
          sessionID: "ses_1",
          role: "assistant",
          finish: true,
          parts: [{ type: "text", text: "Remember this stable project fact." }],
          ...overrides,
        },
      },
    },
  };
}

function makeDeps(overrides: Partial<IncrementalCaptureDeps> = {}) {
  const getLastCaptured = mock(async () => null);
  const appendCaptured = mock(async () => undefined);
  const pruneOldTrackers = mock(async () => 0);
  const addMemory = mock(async (_content: string, _containerTag: string, _metadata?: { type: string; source?: string }) => ({
    success: true as const,
    id: "mem_1",
  }));
  const signalExtract = mock(() => "[assistant] Remember this stable project fact.");
  const deps: IncrementalCaptureDeps = {
    config: makeConfig({ projectContainerTag: "project-tag", signalExtraction: false }),
    client: { addMemory } as unknown as IncrementalCaptureDeps["client"],
    tracker: { getLastCaptured, appendCaptured, pruneOldTrackers },
    signalExtract,
    dataDir: "/tmp/project",
    ...overrides,
  };

  return { deps, getLastCaptured, appendCaptured, addMemory, signalExtract };
}

describe("handleMessageUpdatedForCapture", () => {
  it("captures assistant text to project memory", async () => {
    const { deps, addMemory } = makeDeps();

    await handleMessageUpdatedForCapture(makeEvent(), deps);

    expect(addMemory).toHaveBeenCalledTimes(1);
    expect(addMemory.mock.calls[0]).toEqual([
      "Remember this stable project fact.",
      "project-tag",
      { type: "conversation", source: "assistant" },
    ]);
  });

  it("skips messages with no usable text parts", async () => {
    const { deps, addMemory } = makeDeps();

    await handleMessageUpdatedForCapture(makeEvent({ parts: [{ type: "tool", text: "hidden" }] }), deps);

    expect(addMemory).toHaveBeenCalledTimes(0);
  });

  it("filters synthetic and ignored text parts", async () => {
    const { deps, addMemory } = makeDeps();

    await handleMessageUpdatedForCapture(
      makeEvent({
        parts: [
          { type: "text", text: "synthetic", synthetic: true },
          { type: "text", text: "ignored", ignored: true },
          { type: "text", text: "visible" },
        ],
      }),
      deps,
    );

    expect(addMemory.mock.calls[0]?.[0]).toBe("visible");
  });

  it("skips when signal extraction finds no content", async () => {
    const signalExtract = mock(() => null);
    const { deps, addMemory } = makeDeps({
      config: makeConfig({ projectContainerTag: "project-tag", signalExtraction: true }),
      signalExtract,
    });

    await handleMessageUpdatedForCapture(makeEvent(), deps);

    expect(signalExtract).toHaveBeenCalledTimes(1);
    expect(addMemory).toHaveBeenCalledTimes(0);
  });

  it("skips when tracker already captured the message", async () => {
    const getLastCaptured = mock(async () => "msg_1");
    const { deps, addMemory } = makeDeps({
      tracker: { getLastCaptured, appendCaptured: mock(async () => undefined), pruneOldTrackers: mock(async () => 0) },
    });

    await handleMessageUpdatedForCapture(makeEvent(), deps);

    expect(addMemory).toHaveBeenCalledTimes(0);
  });

  it("swallows tracker and client errors", async () => {
    const addMemory = mock(async (_content: string, _containerTag: string, _metadata?: { type: string; source?: string }) => {
      throw new Error("network down");
    });
    const { deps } = makeDeps({ client: { addMemory } as unknown as IncrementalCaptureDeps["client"] });

    await handleMessageUpdatedForCapture(makeEvent(), deps);
    expect(addMemory).toHaveBeenCalledTimes(1);
  });

  it("appends tracker entry after successful capture", async () => {
    const { deps, appendCaptured } = makeDeps();

    await handleMessageUpdatedForCapture(makeEvent(), deps);

    expect(appendCaptured).toHaveBeenCalledWith("ses_1", "msg_1", "/tmp/project/capture-trackers");
  });

  it("returns early when finish is missing", async () => {
    const { deps, addMemory } = makeDeps();

    await handleMessageUpdatedForCapture(makeEvent({ finish: false }), deps);

    expect(addMemory).toHaveBeenCalledTimes(0);
  });

  it("strips Work_Context scaffolding but captures surrounding user content", async () => {
    const { deps, addMemory } = makeDeps();

    await handleMessageUpdatedForCapture(
      makeEvent({ parts: [{ type: "text", text: "<Work_Context>policy</Work_Context>\nstuff" }] }),
      deps,
    );

    expect(addMemory).toHaveBeenCalledTimes(1);
    expect(addMemory.mock.calls[0]?.[0]).toBe("stuff");
  });

  it("skips a message that is 100% scaffolding (system-reminder only)", async () => {
    const { deps, addMemory } = makeDeps();

    await handleMessageUpdatedForCapture(makeEvent({ parts: [{ type: "text", text: "<system-reminder>do x</system-reminder>" }] }), deps);

    expect(addMemory).toHaveBeenCalledTimes(0);
  });

  it("strips Sisyphus mode preamble and captures only the user content after", async () => {
    const { deps, addMemory } = makeDeps();
    const text = [
      "[analyze-mode]",
      "ANALYSIS MODE. Gather context before diving deep:",
      "some block",
      'Example: delegate_task(subagent_type="explore", prompt="...", run_in_background=true)',
      "",
      "---",
      "",
      "real stuff",
    ].join("\n");

    await handleMessageUpdatedForCapture(makeEvent({ parts: [{ type: "text", text }] }), deps);

    expect(addMemory).toHaveBeenCalledTimes(1);
    expect(addMemory.mock.calls[0]?.[0]).toContain("real stuff");
    expect(addMemory.mock.calls[0]?.[0]).not.toContain("ANALYSIS MODE");
  });

  describe("in-flight dedup (TOCTOU race)", () => {
    afterEach(() => resetIncrementalCaptureState());

    it("deduplicates two concurrent fires for the same (sessionID, messageID)", async () => {
      // Regression: previous code only consulted the on-disk tracker file,
      // which was updated AFTER addMemory. Two events landing in that
      // window both passed `lastCaptured === messageID` and double-saved.
      let resolveTracker: (value: null) => void = () => {};
      const trackerPromise = new Promise<null>((resolve) => {
        resolveTracker = resolve;
      });
      const getLastCaptured = mock(async () => trackerPromise);
      const { deps, addMemory } = makeDeps({
        tracker: { getLastCaptured, appendCaptured: mock(async () => undefined), pruneOldTrackers: mock(async () => 0) },
      });

      const first = handleMessageUpdatedForCapture(makeEvent(), deps);
      const second = handleMessageUpdatedForCapture(makeEvent(), deps);
      resolveTracker(null);
      await Promise.all([first, second]);

      expect(addMemory).toHaveBeenCalledTimes(1);
    });

    it("releases the in-flight slot after completion so genuine retries are possible", async () => {
      const { deps, addMemory } = makeDeps();
      await handleMessageUpdatedForCapture(makeEvent({ id: "msg_retry" }), deps);
      // After completion, a NEW event for the same id+session should NOT
      // be blocked by the in-flight Set (only by the tracker file dedup,
      // which the mock returns null for).
      await handleMessageUpdatedForCapture(makeEvent({ id: "msg_retry" }), deps);
      expect(addMemory).toHaveBeenCalledTimes(2);
    });
  });
});
