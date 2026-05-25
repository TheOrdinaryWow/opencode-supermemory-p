import { getLogger } from "@logtape/logtape";

import type { SupermemoryConfig } from "@/config/schema";
import type { SupermemoryClient } from "@/memory/client";
import { getProjectTag } from "@/memory/tags";
import { isSessionDisabled } from "@/session/disabled";
import { registerSessionCleaner } from "@/session/reaper";
import { createPromptBoundary } from "@/shared/user-prompt";
import type { extractSignalContent, Message } from "@/signal/extract";

const logger = getLogger(["supermemory", "compaction", "pre-save"]);

const PRESERVED_CONTEXT_MESSAGE = "Memories preserved in Supermemory.";
const MAX_TURNS = 20;
const MAX_CONTENT_CHARS = 50_000;

// Process-lifetime dedup. Mirrors the savedSessions guard in
// capture/session-end.ts: a session that already had its compaction
// snapshot written must not write again if the host fires multiple
// `experimental.session.compacting` events for the same id (e.g. when
// the user manually triggers /compact after an automatic one).
const savedCompactions = new Set<string>();

registerSessionCleaner((sessionID) => savedCompactions.delete(sessionID));

/** Test-only: drop process-lifetime state so suites stay isolated. */
export function resetPreSaveState(): void {
  savedCompactions.clear();
}

export interface PreSaveDeps {
  config: SupermemoryConfig;
  client: SupermemoryClient;
  sdkSession: {
    messages(args: { sessionId: string }): Promise<{ messages: Message[] }>;
  };
  /**
   * Heuristic signal extractor. When `config.signalExtraction === true` and
   * this function returns a non-null string, it is preferred over the
   * last-N-turns fallback. When it returns null (no signal keyword matched),
   * we fall back to dumping the last N turns so the compaction summary still
   * has SOMETHING to anchor on — better than losing the entire session.
   */
  signalExtract: typeof extractSignalContent;
  /**
   * Plugin install directory. Used as input to `getProjectTag` so the
   * pre-compaction memory lands on the SAME container tag as the rest of
   * the plugin's writes. Previously this used `process.cwd()`, which
   * drifts if the host process changes working directory and creates
   * orphan memories under a different tag.
   */
  dataDir: string;
}

export async function handlePreCompactionSave(
  input: { sessionID: string; output: { context: string[] } },
  deps: PreSaveDeps,
): Promise<void> {
  try {
    if (deps.config.postCompactionReinject !== true && deps.config.sessionEndSave !== true) return;
    if (isSessionDisabled(input.sessionID)) return;
    // Reserve the dedup slot BEFORE the awaits below — same TOCTOU
    // pattern as session-end. Without this, two `session.compacting`
    // events for the same session both pass the (non-existent) check,
    // both await `sdkSession.messages`, and both write the snapshot.
    if (savedCompactions.has(input.sessionID)) return;
    savedCompactions.add(input.sessionID);

    try {
      const response = await deps.sdkSession.messages({ sessionId: input.sessionID });
      const content = buildSessionContent(response.messages, deps);

      if (content.length > 0) {
        const projectTag = getProjectTag(deps.dataDir, deps.config);
        const result = await deps.client.addMemory(content, projectTag, { type: "conversation", source: "summary" });
        if (!result.ok) {
          logger.warn("[compaction] pre-save failed", { sessionID: input.sessionID, error: result.error.message });
        }
      }
    } catch (error) {
      logger.warn("[compaction] pre-save failed", { sessionID: input.sessionID, error: String(error) });
    } finally {
      input.output.context.push(PRESERVED_CONTEXT_MESSAGE);
    }
  } catch (error) {
    logger.warn("[compaction] pre-save hook failed", { sessionID: input.sessionID, error: String(error) });
  }
}

function buildSessionContent(messages: Message[], deps: PreSaveDeps): string {
  if (deps.config.signalExtraction === true) {
    // Signal extraction here is used as a TRIGGER, not a selector: if the session
    // contains no signal keywords we save nothing (cuts pre-compaction noise).
    // When a signal IS present we still dump the last N turns — the agent needs
    // the conversational context around the signal turn (especially the
    // assistant response that follows) for the post-compaction summary to be
    // useful, and `signalExtract` only walks BACKWARDS from the trigger.
    const triggered = deps.signalExtract(messages, deps.config);
    if (triggered === null) return "";
  }
  return messages.flatMap(formatMessageTurn).slice(-MAX_TURNS).join("\n").slice(0, MAX_CONTENT_CHARS).trim();
}

function formatMessageTurn(message: Message): string[] {
  if (message.role !== "user" && message.role !== "assistant") return [];

  const boundary = createPromptBoundary(message.parts, { sessionID: message.sessionID, role: message.role });
  return boundary.userText.length > 0 ? [`[${message.role}] ${boundary.userText}`] : [];
}
