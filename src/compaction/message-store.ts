import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import fsExtra from "fs-extra";

import { findNearestMessageWithFields } from "@/compaction/finder";
import { defaultLogger } from "@/shared/logger";

const { ensureDirSync } = fsExtra;

/** On-disk roots captured at module-load time so tests can override $HOME first. */
export const MESSAGE_STORAGE = join(homedir(), ".opencode", "messages");
export const PART_STORAGE = join(homedir(), ".opencode", "parts");

/** Locates a session's message dir; OpenCode stores them either at the root or one level deeper. Returns null if missing. */
export function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null;

  const directPath = join(MESSAGE_STORAGE, sessionID);
  if (existsSync(directPath)) return directPath;

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID);
    if (existsSync(sessionPath)) return sessionPath;
  }
  return null;
}

/** Resolves the message dir, creating it if missing. Reuses getMessageDir so the lookup logic stays single-source. */
export function getOrCreateMessageDir(sessionID: string): string {
  ensureDirSync(MESSAGE_STORAGE);
  const found = getMessageDir(sessionID);
  if (found) return found;

  const directPath = join(MESSAGE_STORAGE, sessionID);
  ensureDirSync(directPath);
  return directPath;
}

export function generateMessageId(): string {
  const timestamp = Date.now().toString(16);
  const random = Math.random().toString(36).substring(2, 14);
  return `msg_${timestamp}${random}`;
}

export function generatePartId(): string {
  const timestamp = Date.now().toString(16);
  const random = Math.random().toString(36).substring(2, 10);
  return `prt_${timestamp}${random}`;
}

export interface InjectOriginalMessage {
  agent?: string;
  model?: { providerID?: string; modelID?: string };
  path?: { cwd?: string; root?: string };
}

/**
 * Writes a synthetic user message + text part so the next assistant turn sees `hookContent` as if a user sent it.
 * Agent + model resolve from the live event first, then a nearest-stored-message fallback. Returns false on empty
 * content or write failure. The on-disk format is OpenCode's contract — do not change without coordinating upstream.
 */
export function injectHookMessage(sessionID: string, hookContent: string, originalMessage: InjectOriginalMessage): boolean {
  if (!hookContent || hookContent.trim().length === 0) {
    defaultLogger.info("[compaction] attempted to inject empty content, skipping");
    return false;
  }

  const messageDir = getOrCreateMessageDir(sessionID);
  const fallback = findNearestMessageWithFields(messageDir);

  const now = Date.now();
  const messageID = generateMessageId();
  const partID = generatePartId();

  const resolvedAgent = originalMessage.agent ?? fallback?.agent ?? "general";
  const resolvedModel =
    originalMessage.model?.providerID && originalMessage.model?.modelID
      ? { providerID: originalMessage.model.providerID, modelID: originalMessage.model.modelID }
      : fallback?.model?.providerID && fallback?.model?.modelID
        ? { providerID: fallback.model.providerID, modelID: fallback.model.modelID }
        : undefined;

  const messageMeta = {
    id: messageID,
    sessionID,
    role: "user",
    time: { created: now },
    agent: resolvedAgent,
    model: resolvedModel,
    path: originalMessage.path?.cwd ? { cwd: originalMessage.path.cwd, root: originalMessage.path.root ?? "/" } : undefined,
  };

  const textPart = {
    id: partID,
    type: "text",
    text: hookContent,
    synthetic: true,
    time: { start: now, end: now },
    messageID,
    sessionID,
  };

  try {
    writeFileSync(join(messageDir, `${messageID}.json`), JSON.stringify(messageMeta, null, 2));
    const partDir = join(PART_STORAGE, messageID);
    ensureDirSync(partDir);
    writeFileSync(join(partDir, `${partID}.json`), JSON.stringify(textPart, null, 2));
    defaultLogger.info("[compaction] hook message injected", { sessionID, messageID });
    return true;
  } catch (err) {
    defaultLogger.info("[compaction] failed to inject hook message", { error: String(err) });
    return false;
  }
}
