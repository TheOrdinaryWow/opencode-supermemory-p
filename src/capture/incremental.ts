import { join } from "node:path";

import type { SupermemoryConfig } from "@/config/schema";
import type { SupermemoryClient } from "@/memory/client";
import { getProjectTag } from "@/memory/tags";
import { type Message, type MessagePart, extractSignalContent } from "@/signal/extract";

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

export async function handleMessageUpdatedForCapture(
  input: EventMessageUpdated,
  deps: IncrementalCaptureDeps,
): Promise<void> {
  try {
    if (deps.config.incrementalCapture === false) return;

    const info = input.event.properties?.info;
    const sessionID = info?.sessionID;
    const messageID = info?.id;
    if (!sessionID || !messageID || info.role !== "assistant" || !info.finish) return;

    const textParts = (info.parts ?? []).filter(
      (part) => part.type === "text" && typeof part.text === "string" && !part.synthetic && !part.ignored,
    );
    if (textParts.length === 0) return;

    const message: Message = {
      id: messageID,
      sessionID,
      role: "assistant",
      parts: textParts,
    };

    const extractedContent = deps.config.signalExtraction ? deps.signalExtract([message], deps.config) : null;
    if (deps.config.signalExtraction && extractedContent === null) return;

    const trackersDir = join(deps.dataDir, "capture-trackers");
    const lastCaptured = await deps.tracker.getLastCaptured(sessionID, trackersDir);
    if (lastCaptured === messageID) return;

    const rawContent = extractedContent ?? textParts.map((part) => part.text).join("\n").trim();
    if (rawContent.length === 0) return;

    const content = rawContent.slice(0, deps.config.maxCaptureChars);
    const projectTag = getProjectTag(deps.dataDir, deps.config);
    await deps.client.addMemory(content, projectTag, { type: "conversation" });
    await deps.tracker.appendCaptured(sessionID, messageID, trackersDir);
  } catch {
    // Event hooks should never interrupt OpenCode's main event flow.
  }
}
