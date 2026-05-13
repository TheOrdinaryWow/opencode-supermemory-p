import { join } from "node:path";

import type { SupermemoryConfig } from "@/config/schema";
import { type extractSignalContent, groupIntoTurns, type Message, type MessagePart, type Turn } from "@/signal/extract";

export interface EventSessionDeleted {
  event: {
    type: "session.deleted";
    properties?: {
      info?: {
        id?: string;
      };
    };
  };
}

export interface EventSessionIdle {
  event: {
    type: "session.idle";
    properties?: {
      sessionID?: string;
    };
  };
}

interface SessionMessageInfo {
  id?: string;
  role?: string;
  sessionID?: string;
}

interface SessionMessageRecord {
  info?: SessionMessageInfo;
  parts?: MessagePart[];
}

type SessionMessagesResponse = SessionMessageRecord[] | { data?: SessionMessageRecord[] };

export interface SessionEndDeps {
  config: SupermemoryConfig;
  client: {
    addMemory(content: string, containerTag: string, metadata?: { type: "conversation" }): Promise<unknown>;
  };
  sdkClient: {
    session: {
      messages(input: { sessionId: string }): Promise<SessionMessagesResponse>;
    };
  };
  tracker: Pick<typeof import("@/capture/tracker"), "getLastCaptured" | "pruneOldTrackers">;
  signalExtract: typeof extractSignalContent;
  dataDir: string;
  projectTag: string;
}

const savedSessions = new Set<string>();

export async function handleSessionEnd(input: EventSessionDeleted | EventSessionIdle, deps: SessionEndDeps): Promise<void> {
  try {
    if (deps.config.sessionEndSave === false) return;

    const sessionID = getSessionID(input);
    if (!sessionID || savedSessions.has(sessionID)) return;

    const trackersDir = join(deps.dataDir, "capture-trackers");
    const lastCaptured = await deps.tracker.getLastCaptured(sessionID, trackersDir);
    const response = await deps.sdkClient.session.messages({ sessionId: sessionID });
    const messages = normalizeMessages(response);
    if (messages.length === 0) return;

    const uncapturedMessages = sliceAfterLastCaptured(messages, lastCaptured);
    const turns = groupIntoTurns(uncapturedMessages).filter((turn) => turn.text.length > 0);
    if (turns.length === 0) return;

    const extractedContent = deps.config.signalExtraction ? deps.signalExtract(uncapturedMessages, deps.config) : null;
    if (deps.config.signalExtraction && extractedContent === null) return;

    const rawContent = extractedContent ?? formatTurns(turns);
    const content = rawContent.slice(0, deps.config.maxCaptureChars * 4).trim();
    if (content.length === 0) return;

    await deps.client.addMemory(content, deps.projectTag, { type: "conversation" });
    savedSessions.add(sessionID);

    if (input.event.type === "session.deleted") {
      await deps.tracker.pruneOldTrackers(trackersDir);
    }
  } catch {
    // Event hooks should never interrupt OpenCode's main event flow.
  }
}

function getSessionID(input: EventSessionDeleted | EventSessionIdle): string | undefined {
  if (input.event.type === "session.deleted") {
    return input.event.properties?.info?.id;
  }
  return input.event.properties?.sessionID;
}

function normalizeMessages(response: SessionMessagesResponse): Message[] {
  const records = Array.isArray(response) ? response : (response.data ?? []);
  return records.flatMap((record): Message[] => {
    const info = record.info;
    if (!info?.id || (info.role !== "user" && info.role !== "assistant")) return [];
    return [
      {
        id: info.id,
        role: info.role,
        sessionID: info.sessionID,
        parts: record.parts ?? [],
      },
    ];
  });
}

function sliceAfterLastCaptured(messages: Message[], lastCaptured: string | null): Message[] {
  if (!lastCaptured) return messages;
  const lastCapturedIndex = messages.findIndex((message) => message.id === lastCaptured);
  return lastCapturedIndex >= 0 ? messages.slice(lastCapturedIndex + 1) : messages;
}

function formatTurns(turns: Turn[]): string {
  return turns
    .map((turn) => `[${turn.role}] ${turn.text}`)
    .join("\n")
    .trim();
}
