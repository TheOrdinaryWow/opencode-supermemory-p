/**
 * Thin delegate for the OpenCode `event` plugin hook. Forwards every
 * event to the compaction hook (when configured) and returns. The hook
 * body in `src/index.ts` is intentionally tiny so the heavy lifting
 * stays in `src/compaction/` where it can be unit-tested in isolation.
 */

import { handleMessageUpdatedForCapture, type IncrementalCaptureDeps } from "@/capture/incremental";
import * as tracker from "@/capture/tracker";
import { getConfig } from "@/config/loader";
import { resultSupermemoryClient } from "@/memory/client";
import { extractSignalContent } from "@/signal/extract";

export interface EventInput {
  event: { type: string; properties?: unknown };
}

export interface EventDeps {
  compactionHook: { event(input: EventInput): Promise<void> } | null;
  incrementalCapture?: IncrementalCaptureDeps;
}

export async function handleEvent(input: EventInput, deps: EventDeps): Promise<void> {
  const props = input.event.properties as Record<string, unknown> | undefined;
  const info = props?.info as { role?: string; finish?: unknown } | undefined;
  if (input.event.type === "message.updated" && info?.role === "assistant" && info.finish) {
    void handleMessageUpdatedForCapture(input as Parameters<typeof handleMessageUpdatedForCapture>[0], deps.incrementalCapture ?? createDefaultIncrementalCaptureDeps());
  }

  if (deps.compactionHook) {
    await deps.compactionHook.event(input);
  }
}

function createDefaultIncrementalCaptureDeps(): IncrementalCaptureDeps {
  return {
    config: getConfig(),
    client: resultSupermemoryClient,
    tracker,
    signalExtract: extractSignalContent,
    dataDir: process.cwd(),
  };
}
