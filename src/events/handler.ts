/**
 * Thin delegate for the OpenCode `event` plugin hook. Forwards every
 * event to the compaction hook (when configured) and returns. The hook
 * body in `src/index.ts` is intentionally tiny so the heavy lifting
 * stays in `src/compaction/` where it can be unit-tested in isolation.
 */

import { handleMessageUpdatedForCapture, type IncrementalCaptureDeps } from "@/capture/incremental";
import { handleSessionEnd, type SessionEndDeps } from "@/capture/session-end";
import { handleSessionCompacted } from "@/compaction/post-reinject";
import { getConfig } from "@/config/loader";
import type { SupermemoryConfig } from "@/config/schema";
import { reapSession } from "@/session/reaper";

export interface EventInput {
  event: { type: string; properties?: unknown };
}

export interface EventDeps {
  compactionHook: { event(input: EventInput): Promise<void> } | null;
  config?: SupermemoryConfig;
  incrementalCapture?: IncrementalCaptureDeps;
  sessionEnd?: SessionEndDeps;
}

export async function handleEvent(input: EventInput, deps: EventDeps): Promise<void> {
  const props = input.event.properties as Record<string, unknown> | undefined;
  const info = props?.info as { role?: string; finish?: unknown } | undefined;
  if (input.event.type === "message.updated" && info?.role === "assistant" && info.finish && deps.incrementalCapture) {
    void handleMessageUpdatedForCapture(input as Parameters<typeof handleMessageUpdatedForCapture>[0], deps.incrementalCapture);
  }

  if ((input.event.type === "session.deleted" || input.event.type === "session.idle") && deps.sessionEnd) {
    void handleSessionEnd(input as Parameters<typeof handleSessionEnd>[0], deps.sessionEnd);
  }

  if (input.event.type === "session.compacted") {
    handleSessionCompacted(input as Parameters<typeof handleSessionCompacted>[0], deps.config ?? getConfig());
  }

  if (deps.compactionHook) {
    await deps.compactionHook.event(input);
  }

  // Fan out cross-module cleanup AFTER the dependent handlers above have
  // ALREADY been kicked off via `void` (fire-and-forget). Those handlers
  // capture sessionID by value, so reaping the registry entries now does
  // not affect their inflight work. Without this, every long-running
  // OpenCode process slowly accumulates per-session state.
  if (input.event.type === "session.deleted") {
    const sessionID = (props?.info as { id?: string } | undefined)?.id;
    if (sessionID) reapSession(sessionID);
  }
}
