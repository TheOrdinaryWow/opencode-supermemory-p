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

import type { SupermemoryConfig } from "../config/schema.js";
import { formatContextForPrompt } from "../services/context.js";

import { detectMemoryKeyword } from "./keywords.js";
import { MEMORY_NUDGE_MESSAGE } from "./nudge.js";

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

type ProfileResult =
  | ({ success: true } & ProfileResponse)
  | { success: false; error?: string };

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
  searchMemories: (query: string, containerTag: string) => Promise<SearchResult>;
  listMemories: (containerTag: string, limit?: number) => Promise<ListResult>;
}

export interface ChatHandlerDeps {
  client: ChatClientLike;
  config: Pick<SupermemoryConfig, "keywordPatterns" | "maxProjectMemories">;
  tags: { user: string; project: string };
  injectedSessions: Set<string>;
  log: (message: string, data?: unknown) => void;
  isConfigured: () => boolean;
}

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
export async function handleChatMessage(
  input: ChatHandlerInput,
  output: ChatHandlerOutput,
  deps: ChatHandlerDeps,
): Promise<void> {
  if (!deps.isConfigured()) return;

  const start = Date.now();

  try {
    const textParts = output.parts.filter(
      (p): p is Part & { type: "text"; text: string } => p.type === "text",
    );

    if (textParts.length === 0) {
      deps.log("chat.message: no text parts found");
      return;
    }

    const userMessage = textParts.map((p) => p.text).join("\n");

    if (!userMessage.trim()) {
      deps.log("chat.message: empty message, skipping");
      return;
    }

    deps.log("chat.message: processing", {
      messagePreview: userMessage.slice(0, 100),
      partsCount: output.parts.length,
      textPartsCount: textParts.length,
    });

    if (detectMemoryKeyword(userMessage, deps.config)) {
      deps.log("chat.message: memory keyword detected");
      const nudgePart: Part = {
        id: `prt_supermemory-nudge-${Date.now()}`,
        sessionID: input.sessionID,
        messageID: output.message.id,
        type: "text",
        text: MEMORY_NUDGE_MESSAGE,
        synthetic: true,
      };
      output.parts.push(nudgePart);
    }

    const isFirstMessage = !deps.injectedSessions.has(input.sessionID);

    if (isFirstMessage) {
      deps.injectedSessions.add(input.sessionID);

      const [profileResult, userMemoriesResult, projectMemoriesListResult] = await Promise.all([
        deps.client.getProfile(deps.tags.user, userMessage),
        deps.client.searchMemories(userMessage, deps.tags.user),
        deps.client.listMemories(deps.tags.project, deps.config.maxProjectMemories),
      ]);

      const profile = profileResult.success ? profileResult : null;
      const userMemories = userMemoriesResult.success ? userMemoriesResult : { results: [] };
      const projectMemoriesList = projectMemoriesListResult.success
        ? projectMemoriesListResult
        : { memories: [] };

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
        const contextPart: Part = {
          id: `prt_supermemory-context-${Date.now()}`,
          sessionID: input.sessionID,
          messageID: output.message.id,
          type: "text",
          text: memoryContext,
          synthetic: true,
        };

        output.parts.unshift(contextPart);

        const duration = Date.now() - start;
        deps.log("chat.message: context injected", {
          duration,
          contextLength: memoryContext.length,
        });
      }
    }
  } catch (error) {
    deps.log("chat.message: ERROR", { error: String(error) });
  }
}
