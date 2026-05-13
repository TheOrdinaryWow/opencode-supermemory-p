import { getLogger } from "@logtape/logtape";

import type { SupermemoryConfig } from "@/config/schema";
import type { SupermemoryClient } from "@/memory/client";
import { getProjectTag } from "@/memory/tags";
import type { Message } from "@/signal/extract";

const logger = getLogger(["supermemory", "compaction", "pre-save"]);

const PRESERVED_CONTEXT_MESSAGE = "Memories preserved in Supermemory.";
const MAX_TURNS = 20;
const MAX_CONTENT_CHARS = 50_000;

export interface PreSaveDeps {
  config: SupermemoryConfig;
  client: SupermemoryClient;
  sdkSession: {
    messages(args: { sessionId: string }): Promise<{ messages: Message[] }>;
  };
}

export async function handlePreCompactionSave(
  input: { sessionID: string; output: { context: string[] } },
  deps: PreSaveDeps,
): Promise<void> {
  try {
    if (deps.config.postCompactionReinject !== true && deps.config.sessionEndSave !== true) return;

    try {
      const response = await deps.sdkSession.messages({ sessionId: input.sessionID });
      const content = buildSessionContent(response.messages);

      if (content.length > 0) {
        const projectTag = getProjectTag(process.cwd(), deps.config);
        const result = await deps.client.addMemory(content, projectTag, { type: "conversation" });
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

function buildSessionContent(messages: Message[]): string {
  return messages.flatMap(formatMessageTurn).slice(-MAX_TURNS).join("\n").slice(0, MAX_CONTENT_CHARS).trim();
}

function formatMessageTurn(message: Message): string[] {
  if (message.role !== "user" && message.role !== "assistant") return [];

  const text = message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string" && !part.synthetic && !part.ignored)
    .map((part) => part.text)
    .join("\n")
    .trim();

  return text.length > 0 ? [`[${message.role}] ${text}`] : [];
}
