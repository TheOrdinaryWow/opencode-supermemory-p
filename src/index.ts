import { homedir } from "node:os";
import { join } from "node:path";

import type { Plugin, PluginInput } from "@opencode-ai/plugin";

import * as tracker from "@/capture/tracker";
import { handleChatMessage } from "@/chat/handler";
import { type CompactionContext, createCompactionHook } from "@/compaction/index";
import { createModelLimitLookup } from "@/compaction/model-limits";
import { pendingReinjectSessions } from "@/compaction/post-reinject";
import { handlePreCompactionSave } from "@/compaction/pre-save";
import { getConfig } from "@/config/loader";
import { handleEvent } from "@/events/handler";
import { SupermemoryClient, supermemoryClient } from "@/memory/client";
import { createDedupCache } from "@/memory/dedup";
import { getTags } from "@/memory/tags";
import { createSessionState } from "@/session/state";
import { initLogger, rootLogger } from "@/shared/logger";
import { extractSignalContent, type Message, type MessagePart } from "@/signal/extract";
import { createSupermemoryTool } from "@/tool/index";

const DEDUP_DATA_DIR = join(homedir(), ".local", "share", "opencode-supermemory-p");

export const SupermemoryPlugin: Plugin = async (ctx: PluginInput) => {
  const deps = createDeps(ctx);
  const compactionHook =
    deps.config.apiKey && ctx.client
      ? createCompactionHook(ctx as CompactionContext, deps.tags, {
          threshold: deps.config.compactionThreshold,
          getModelLimit: createModelLimitLookup(ctx, deps.log),
        })
      : null;
  return {
    "chat.message": (input, output) => handleChatMessage(input, output, deps),
    tool: { supermemory: createSupermemoryTool({ tags: deps.tags, client: supermemoryClient }) },
    event: (input: { event: { type: string; properties?: unknown } }) =>
      deps.isConfigured()
        ? handleEvent(input, {
            compactionHook,
            config: deps.config,
            incrementalCapture: {
              config: deps.config,
              client: deps.resultClient,
              tracker,
              signalExtract: extractSignalContent,
              dataDir: ctx.directory,
            },
            sessionEnd: ctx.client
              ? {
                  config: deps.config,
                  client: deps.resultClient,
                  sdkClient: {
                    session: {
                      messages: ({ sessionId }) =>
                        ctx.client.session.messages({ path: { id: sessionId }, query: { directory: ctx.directory } }),
                    },
                  },
                  tracker,
                  signalExtract: extractSignalContent,
                  dataDir: ctx.directory,
                  projectTag: deps.tags.project,
                }
              : undefined,
          })
        : Promise.resolve(),
    "experimental.session.compacting": (input, output) =>
      deps.isConfigured() && ctx.client
        ? handlePreCompactionSave(
            { sessionID: input.sessionID, output },
            {
              config: deps.config,
              client: deps.resultClient,
              sdkSession: {
                messages: async ({ sessionId }) => ({
                  messages: normalizeSdkMessages(
                    await ctx.client.session.messages({ path: { id: sessionId }, query: { directory: ctx.directory } }),
                  ),
                }),
              },
              signalExtract: extractSignalContent,
            },
          )
        : Promise.resolve(),
  };
};

export default SupermemoryPlugin;

function createDeps(ctx: PluginInput) {
  initLogger();
  const config = getConfig();
  const tags = getTags(ctx.directory);
  const sessionState = createSessionState();
  const dedupCache = createDedupCache({
    dedupEnabled: config.dedupEnabled,
    dedupCacheSize: config.dedupCacheSize,
    dataDir: DEDUP_DATA_DIR,
  });
  const resultClient = new SupermemoryClient({ dedupCache });
  const client = createLegacyClient(resultClient);
  const isConfigured = () => !!config.apiKey;
  const log = (message: string, data?: unknown) => {
    rootLogger.info(message, data as Record<string, unknown> | undefined);
  };
  process.on("beforeExit", () => {
    void dedupCache.flush().catch((error) => log("dedup cache flush failed", { error: String(error) }));
  });
  log("Plugin init", { directory: ctx.directory, tags, configured: isConfigured() });
  if (!isConfigured()) log("Plugin disabled - SUPERMEMORY_API_KEY not set");
  return { client, resultClient, config, tags, injectedSessions: sessionState, pendingReinjectSessions, log, isConfigured };
}

function normalizeSdkMessages(response: {
  data?: Array<{ info?: { id?: string; role?: string; sessionID?: string }; parts?: MessagePart[] }>;
}): Message[] {
  return (response.data ?? []).flatMap((record): Message[] => {
    const info = record.info;
    if (!info?.id || (info.role !== "user" && info.role !== "assistant")) return [];
    return [{ id: info.id, role: info.role, sessionID: info.sessionID, parts: record.parts ?? [] }];
  });
}

function createLegacyClient(client: SupermemoryClient) {
  return {
    async searchMemories(query: string, containerTag: string | string[]) {
      const result = await client.searchMemories(query, containerTag);
      return result.ok ? result.value : { success: false as const, error: result.error.message, results: [], total: 0, timing: 0 };
    },
    async getProfile(containerTag: string, query?: string) {
      const result = await client.getProfile(containerTag, query);
      return result.ok ? result.value : { success: false as const, error: result.error.message, profile: null };
    },
    async addMemory(content: string, containerTag: string, metadata?: Parameters<SupermemoryClient["addMemory"]>[2]) {
      const result = await client.addMemory(content, containerTag, metadata);
      return result.ok ? result.value : { success: false as const, error: result.error.message };
    },
    async deleteMemory(memoryId: string, containerTag: string) {
      const result = await client.deleteMemory(memoryId, containerTag);
      return result.ok ? result.value : { success: false as const, error: result.error.message };
    },
    async listMemories(containerTag: string, limit = 20) {
      const result = await client.listMemories(containerTag, limit);
      return result.ok
        ? result.value
        : {
            success: false as const,
            error: result.error.message,
            memories: [],
            pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
          };
    },
    async ingestConversation(
      conversationId: string,
      messages: Parameters<SupermemoryClient["ingestConversation"]>[1],
      containerTags: string[],
      metadata?: Record<string, string | number | boolean>,
    ) {
      const result = await client.ingestConversation(conversationId, messages, containerTags, metadata);
      return result.ok ? result.value : { success: false as const, error: result.error.message };
    },
  };
}
