import type { Part } from "@opencode-ai/sdk";

import type { SupermemoryConfig } from "@/config/schema";
import { formatContextForPrompt } from "@/memory/context";
import { stripInboundMetadata } from "@/memory/metadata-strip";
import { generatePartId } from "@/shared/ids";
import { withTimeout } from "@/shared/timeout";
import { createPromptBoundary, sanitizeMemoryContextForInjection } from "@/shared/user-prompt";

const RECALL_THROTTLE_MS = 2_000;
const RECALL_TIMEOUT_MS = 2_000;

const lastRecallAt = new Map<string, number>();

type SearchResult =
  | { success: true; results?: Array<{ similarity?: number; memory?: string; chunk?: string; createdAt?: string | Date }> }
  | { success: false; error?: string };

export interface EveryMessageRecallInput {
  sessionID: string;
}

export interface EveryMessageRecallOutput {
  message: { id: string };
  parts: Part[];
}

export interface EveryMessageRecallDeps {
  client: {
    searchMemories: (query: string, containerTags: string | string[]) => Promise<SearchResult>;
  };
  config: Pick<SupermemoryConfig, "injectProfile" | "maxProfileItems" | "recallKeywordPatterns"> &
    Partial<Pick<SupermemoryConfig, "relativeTimeDisplay" | "profileCrossArrayDedup" | "memoUsageFooter">>;
  tags: { user: string; project: string };
  log: (message: string, data?: unknown) => void;
}

export function detectRecallKeyword(userMessage: string, config: Partial<Pick<SupermemoryConfig, "recallKeywordPatterns">>): boolean {
  const normalized = userMessage.toLowerCase();
  return (config.recallKeywordPatterns ?? []).some((pattern) => pattern.trim().length > 0 && normalized.includes(pattern.toLowerCase()));
}

function getUserMessage(parts: Part[], sessionID: string): string {
  return createPromptBoundary(parts, { sessionID, role: "user" }).userText;
}

export async function runEveryMessageRecall(
  input: EveryMessageRecallInput,
  output: EveryMessageRecallOutput,
  deps: EveryMessageRecallDeps,
): Promise<void> {
  const now = Date.now();
  const previous = lastRecallAt.get(input.sessionID);
  if (previous !== undefined && now - previous < RECALL_THROTTLE_MS) {
    deps.log("chat.message: recall throttled", { sessionID: input.sessionID });
    return;
  }
  lastRecallAt.set(input.sessionID, now);

  const strippedQuery = stripInboundMetadata(getUserMessage(output.parts, input.sessionID));
  if (!strippedQuery) {
    deps.log("chat.message: recall query empty after metadata stripping");
    return;
  }

  try {
    const result = await withTimeout(
      deps.client.searchMemories(strippedQuery, [deps.tags.user, deps.tags.project]),
      RECALL_TIMEOUT_MS,
      "every-message recall",
    );
    const userMemories = result.success ? result : { results: [] };
    const memoryContext = formatContextForPrompt(null, userMemories, { results: [] }, deps.config);

    if (!memoryContext) return;

    const safeMemoryContext = sanitizeMemoryContextForInjection(memoryContext);

    output.parts.unshift({
      id: generatePartId(),
      sessionID: input.sessionID,
      messageID: output.message.id,
      type: "text",
      text: `<supermemory-context>\n${safeMemoryContext}\n</supermemory-context>`,
      synthetic: true,
    });
  } catch (error) {
    deps.log("chat.message: recall ERROR", { error: String(error) });
  }
}
