import type { Plugin, PluginInput } from "@opencode-ai/plugin";

import { handleChatMessage } from "./chat/handler.js";
import { getConfig } from "./config/loader.js";
import { handleEvent } from "./events/handler.js";
import { type CompactionContext, createCompactionHook } from "./compaction/index.js";
import { supermemoryClient } from "./memory/client.js";
import { getTags } from "./memory/tags.js";
import { createSessionState } from "./session/state.js";
import { defaultLogger, initLogger } from "./shared/logger.js";
import { createSupermemoryTool } from "./tool/index.js";

export const SupermemoryPlugin: Plugin = async (ctx: PluginInput) => {
  const deps = createDeps(ctx);
  const compactionHook = deps.config.apiKey && ctx.client ? createCompactionHook(ctx as CompactionContext, deps.tags, {
    threshold: deps.config.compactionThreshold, getModelLimit: createModelLimitLookup(ctx, deps.log),
  }) : null;
  return {
    "chat.message": (input, output) => handleChatMessage(input, output, deps),
    tool: { supermemory: createSupermemoryTool({ tags: deps.tags, client: supermemoryClient }) },
    event: (input: { event: { type: string; properties?: unknown } }) => handleEvent(input, { compactionHook }),
  };
};

function createDeps(ctx: PluginInput) {
  initLogger();
  const config = getConfig();
  const tags = getTags(ctx.directory);
  const sessionState = createSessionState();
  const isConfigured = () => !!config.apiKey;
  const log = defaultLogger.info.bind(defaultLogger);
  log("Plugin init", { directory: ctx.directory, tags, configured: isConfigured() }); if (!isConfigured()) log("Plugin disabled - SUPERMEMORY_API_KEY not set");
  return { client: supermemoryClient, config, tags, injectedSessions: sessionState, log, isConfigured };
}

function createModelLimitLookup(ctx: PluginInput, log: (message: string, data?: unknown) => void) {
  const modelLimits = new Map<string, number>();
  (async () => {
    try {
      const response = await ctx.client.provider.list();
      for (const provider of response.data?.all ?? []) {
        for (const [modelId, model] of Object.entries(provider.models ?? {})) if (model.limit?.context) modelLimits.set(`${provider.id}/${modelId}`, model.limit.context);
      }
      log("Model limits loaded", { count: modelLimits.size });
    } catch (error) {
      log("Failed to fetch model limits", { error: String(error) });
    }
  })();
  return (providerID: string, modelID: string) => modelLimits.get(`${providerID}/${modelID}`);
}
