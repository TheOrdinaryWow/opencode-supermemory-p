/**
 * The body of the OpenCode `chat.message` hook, extracted from
 * `src/index.ts` so it can be tested in isolation.
 *
 * Everything the handler needs is passed via `deps` — no module-level
 * singletons, no env reads, no filesystem touches. This keeps the unit
 * test deterministic (no `mock.module` gymnastics required) and makes
 * the side effects the handler relies on (logging, session tracking,
 * client calls) explicit at the call site.
 *
 * The runtime wiring still lives in `src/index.ts`: it builds a `deps`
 * object once during plugin init and routes `chat.message` through this
 * function on every call.
 */

import type { Part } from "@opencode-ai/sdk";
import type { ProfileResponse } from "supermemory/resources";

import { detectMemoryKeyword } from "@/chat/keywords";
import { MEMORY_NUDGE_MESSAGE } from "@/chat/nudge";
import type { SupermemoryConfig } from "@/config/schema";
import { formatContextForPrompt } from "@/memory/context";
import { detectRecallKeyword, runEveryMessageRecall } from "@/recall/every-message";
import { shouldPeriodicReinject } from "@/recall/periodic";
import type { SessionState } from "@/session/state";
import { generatePartId } from "@/shared/ids";
import { createPromptBoundary, sanitizeMemoryContextForInjection } from "@/shared/user-prompt";

export interface ChatHandlerInput {
  sessionID: string;
}

export interface ChatHandlerOutput {
  message: { id: string };
  parts: Part[];
}

type SearchResult =
  | { success: true; results?: Array<{ similarity?: number; memory?: string; chunk?: string }> }
  | { success: false; error?: string };

type ProfileResult = ({ success: true } & ProfileResponse) | { success: false; error?: string };

type ListResult =
  | {
      success: true;
      memories?: Array<{
        id: string;
        summary?: string | null;
        content?: string | null;
        title?: string | null;
        metadata?: unknown;
      }>;
    }
  | { success: false; error?: string };

export interface ChatClientLike {
  getProfile: (containerTag: string, query?: string) => Promise<ProfileResult>;
  searchMemories: (query: string, containerTag: string | string[]) => Promise<SearchResult>;
  listMemories: (containerTag: string, limit?: number) => Promise<ListResult>;
}

export interface ChatHandlerDeps {
  client: ChatClientLike;
  config: Pick<
    SupermemoryConfig,
    | "keywordPatterns"
    | "maxProjectMemories"
    | "injectProfile"
    | "maxProfileItems"
    | "recallKeywordPatterns"
    | "everyMessageRecall"
    | "reinjectEveryN"
  > &
    Partial<Pick<SupermemoryConfig, "relativeTimeDisplay" | "profileCrossArrayDedup" | "memoUsageFooter">>;
  tags: { user: string; project: string };
  injectedSessions: Pick<SessionState, "markInjected" | "wasInjected">;
  pendingReinjectSessions?: Pick<Set<string>, "delete" | "has">;
  log: (message: string, data?: unknown) => void;
  isConfigured: () => boolean;
}

const msgCounter = new Map<string, number>();

/**
 * Runs once per assistant message. Responsibilities:
 *  1. Bail out fast when the plugin is unconfigured or the message has no
 *     text content.
 *  2. Append the static nudge part when a memory-trigger keyword is
 *     detected.
 *  3. On the first message of a session, fetch profile + user memories +
 *     project memory list in parallel and prepend a synthesized context
 *     part containing the formatted Supermemory bundle.
 *
 * All errors are swallowed and logged — the hook must never throw, or
 * OpenCode will surface the failure to the user.
 */
export async function handleChatMessage(input: ChatHandlerInput, output: ChatHandlerOutput, deps: ChatHandlerDeps): Promise<void> {
  const completedMessages = msgCounter.get(input.sessionID) ?? 0;

  const start = Date.now();

  try {
    if (!deps.isConfigured()) return;

    const boundary = createPromptBoundary(output.parts, { sessionID: input.sessionID, role: "user" });
    const userMessage = boundary.userText;

    if (!userMessage) {
      deps.log("chat.message: empty message, skipping", { isPolluted: boundary.isPolluted });
      return;
    }

    deps.log("chat.message: processing", {
      messagePreview: userMessage.slice(0, 100),
      partsCount: output.parts.length,
      isPolluted: boundary.isPolluted,
    });

    if (detectMemoryKeyword(userMessage, deps.config)) {
      deps.log("chat.message: memory keyword detected");
      const nudgePart: Part = {
        id: generatePartId(),
        sessionID: input.sessionID,
        messageID: output.message.id,
        type: "text",
        text: MEMORY_NUDGE_MESSAGE,
        synthetic: true,
      };
      output.parts.push(nudgePart);
    }

    const isFirstMessage = !deps.injectedSessions.wasInjected(input.sessionID);
    const hasRecallKeyword = detectRecallKeyword(userMessage, deps.config);
    const hasPendingReinject = deps.pendingReinjectSessions?.has(input.sessionID) === true;
    const shouldRecallAfterFirstMessage = deps.config.everyMessageRecall === true || hasRecallKeyword || hasPendingReinject;
    let injectedThisTurn = false;

    if (isFirstMessage) {
      deps.injectedSessions.markInjected(input.sessionID);

      const [profileResult, userMemoriesResult, projectMemoriesListResult] = await Promise.all([
        deps.client.getProfile(deps.tags.user, userMessage),
        deps.client.searchMemories(userMessage, deps.tags.user),
        deps.client.listMemories(deps.tags.project, deps.config.maxProjectMemories),
      ]);

      const profile = profileResult.success ? profileResult : null;
      const userMemories = userMemoriesResult.success ? userMemoriesResult : { results: [] };
      const projectMemoriesList = projectMemoriesListResult.success ? projectMemoriesListResult : { memories: [] };

      const projectMemories = {
        results: (projectMemoriesList.memories || []).map((m) => ({
          id: m.id,
          memory: m.summary || m.content || m.title || "",
          similarity: 1,
          title: m.title,
          metadata: m.metadata,
        })),
        total: projectMemoriesList.memories?.length || 0,
        timing: 0,
      };

      const memoryContext = formatContextForPrompt(profile, userMemories, projectMemories);

      if (memoryContext) {
        const safeMemoryContext = sanitizeMemoryContextForInjection(memoryContext);
        const contextPart: Part = {
          id: generatePartId(),
          sessionID: input.sessionID,
          messageID: output.message.id,
          type: "text",
          text: `<supermemory-context>\n${safeMemoryContext}\n</supermemory-context>`,
          synthetic: true,
        };

        output.parts.unshift(contextPart);

        const duration = Date.now() - start;
        deps.log("chat.message: context injected", {
          duration,
          contextLength: memoryContext.length,
        });
        injectedThisTurn = true;
      }
    } else {
      if (shouldRecallAfterFirstMessage) {
        await runEveryMessageRecall(input, output, deps);
        injectedThisTurn = true;
        if (hasPendingReinject) {
          deps.pendingReinjectSessions?.delete(input.sessionID);
        }
      }

      if (!injectedThisTurn && shouldPeriodicReinject(input.sessionID, deps.config.reinjectEveryN, msgCounter)) {
        await runEveryMessageRecall(input, output, deps);
      }
    }
  } catch (error) {
    deps.log("chat.message: ERROR", { error: String(error) });
  } finally {
    msgCounter.set(input.sessionID, completedMessages + 1);
  }
}
