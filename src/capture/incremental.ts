import { join } from "node:path";

import type { SupermemoryConfig } from "@/config/schema";
import type { SupermemoryClient } from "@/memory/client";
import { getProjectTag } from "@/memory/tags";
import { isSessionDisabled } from "@/session/disabled";
import { registerSessionCleaner } from "@/session/reaper";
import { createPromptBoundary } from "@/shared/user-prompt";
import type { extractSignalContent, Message, MessagePart } from "@/signal/extract";

export interface EventMessageUpdated {
  event: {
    type: string;
    properties?: {
      info?: {
        id?: string;
        sessionID?: string;
        role?: string;
        finish?: unknown;
        parts?: MessagePart[];
      };
    };
  };
}

export interface IncrementalCaptureDeps {
  config: SupermemoryConfig;
  client: Pick<SupermemoryClient, "addMemory">;
  tracker: typeof import("@/capture/tracker");
  signalExtract: typeof extractSignalContent;
  dataDir: string;
}

// Process-lifetime guard against the SAME assistant message being captured
// twice when OpenCode fires `message.updated` with `finish` more than once
// for the same id. The tracker file is the durable dedup, but it only
// updates AFTER `addMemory` succeeds — leaving a wide TOCTOU window during
// the inflight network call. Keyed by `${sessionID}:${messageID}`. Entries
// are dropped after each attempt (success or failure) so genuine retries
// stay possible.
const inFlight = new Set<string>();

// Drop any inflight slots for the dying session. `messageID` is unknown
// here so we scan and delete every entry whose key starts with the id.
registerSessionCleaner((sessionID) => {
  const prefix = `${sessionID}:`;
  for (const key of inFlight) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
});

/** Test-only: drop process-lifetime state so suites stay isolated. */
export function resetIncrementalCaptureState(): void {
  inFlight.clear();
}

export async function handleMessageUpdatedForCapture(input: EventMessageUpdated, deps: IncrementalCaptureDeps): Promise<void> {
  try {
    if (deps.config.incrementalCapture === false) return;
    if (isSessionDisabled(input.event.properties?.info?.sessionID)) return;

    const info = input.event.properties?.info;
    const sessionID = info?.sessionID;
    const messageID = info?.id;
    if (!sessionID || !messageID || info.role !== "assistant" || !info.finish) return;

    // Reserve the in-flight slot BEFORE any awaits. Without this, two
    // `message.updated` events for the same (sessionID, messageID) pair
    // can both pass the `lastCaptured === messageID` tracker check below
    // and both write a duplicate memory. The tracker file is durable
    // dedup ACROSS process restarts but cannot help during an inflight
    // network call.
    const inFlightKey = `${sessionID}:${messageID}`;
    if (inFlight.has(inFlightKey)) return;
    inFlight.add(inFlightKey);
    try {
      const allParts = info.parts ?? [];
      const boundary = createPromptBoundary(allParts, { sessionID, role: "assistant" });
      if (!boundary.userText) return;

      const cleanPart: MessagePart = { type: "text", text: boundary.userText };
      const message: Message = {
        id: messageID,
        sessionID,
        role: "assistant",
        parts: [cleanPart],
      };

      const extractedContent = deps.config.signalExtraction ? deps.signalExtract([message], deps.config) : null;
      if (deps.config.signalExtraction && extractedContent === null) return;

      const trackersDir = join(deps.dataDir, "capture-trackers");
      const lastCaptured = await deps.tracker.getLastCaptured(sessionID, trackersDir);
      if (lastCaptured === messageID) return;

      const rawContent = extractedContent ?? boundary.userText;
      if (rawContent.length === 0) return;

      const content = rawContent.slice(0, deps.config.maxCaptureChars);
      const projectTag = getProjectTag(deps.dataDir, deps.config);
      await deps.client.addMemory(content, projectTag, { type: "conversation", source: "assistant" });
      await deps.tracker.appendCaptured(sessionID, messageID, trackersDir);
    } finally {
      inFlight.delete(inFlightKey);
    }
  } catch {
    // Event hooks should never interrupt OpenCode's main event flow.
  }
}
