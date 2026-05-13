import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";

const logger = getLogger(["supermemory", "compaction", "finder"]);

/**
 * Minimal subset of an OpenCode stored message that compaction logic cares
 * about. Used to recover agent + provider/model identity when the live event
 * payload is missing those fields.
 */
export interface StoredMessage {
  agent?: string;
  model?: { providerID?: string; modelID?: string };
}

/**
 * Walks `messageDir` (newest first by lexicographic filename — IDs are
 * timestamp-prefixed) and returns the first stored message that has both an
 * agent string and a complete provider+model pair. Returns null when the
 * directory cannot be read or no qualifying message exists.
 *
 * Per-file parse / read errors are silently swallowed: corrupt JSON in one
 * message must not abort the search through the rest. This is intentional —
 * the function is a best-effort fallback used by the compaction hook before
 * it gives up on a session, not a strict consistency check.
 *
 * Single source of truth: this is the canonical implementation. The hook in
 * src/services/compaction.ts and any future caller MUST import it from here
 * rather than reimplementing.
 */
export function findNearestMessageWithFields(messageDir: string): StoredMessage | null {
  try {
    const files = readdirSync(messageDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();

    for (const file of files) {
      try {
        const content = readFileSync(join(messageDir, file), "utf-8");
        const msg = JSON.parse(content) as StoredMessage;
        if (msg.agent && msg.model?.providerID && msg.model?.modelID) {
          return msg;
        }
      } catch (err) {
        logger.warn("[compaction] failed to read stored message", { file, error: String(err) });
      }
    }
  } catch (err) {
    logger.warn("[compaction] failed to scan stored messages", { messageDir, error: String(err) });
    return null;
  }
  return null;
}
