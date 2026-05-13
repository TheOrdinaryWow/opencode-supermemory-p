import type { Plugin, PluginInput } from "@opencode-ai/plugin";

import { handleChatMessage } from "@/chat/handler";
import { type CompactionContext, createCompactionHook } from "@/compaction/index";
import { createModelLimitLookup } from "@/compaction/model-limits";
import { getConfig } from "@/config/loader";
import { handleEvent } from "@/events/handler";
import { supermemoryClient } from "@/memory/client";
import { getTags } from "@/memory/tags";
import { createSessionState } from "@/session/state";
import { initLogger, rootLogger } from "@/shared/logger";
import { createSupermemoryTool } from "@/tool/index";

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
    event: (input: { event: { type: string; properties?: unknown } }) => handleEvent(input, { compactionHook }),
  };
};

export default SupermemoryPlugin;

function createDeps(ctx: PluginInput) {
  initLogger();
  const config = getConfig();
  const tags = getTags(ctx.directory);
  const sessionState = createSessionState();
  const isConfigured = () => !!config.apiKey;
  const log = (message: string, data?: unknown) => {
    rootLogger.info(message, data as Record<string, unknown> | undefined);
  };
  log("Plugin init", { directory: ctx.directory, tags, configured: isConfigured() });
  if (!isConfigured()) log("Plugin disabled - SUPERMEMORY_API_KEY not set");
  return { client: supermemoryClient, config, tags, injectedSessions: sessionState, log, isConfigured };
}
