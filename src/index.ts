import type { Plugin, PluginInput } from "@opencode-ai/plugin";

import { handleChatMessage } from "./chat/handler.js";
import { CONFIG, isConfigured } from "./config.js";
import { supermemoryClient } from "./services/client.js";
import { type CompactionContext, createCompactionHook } from "./services/compaction.js";
import { log } from "./services/logger.js";
import { getTags } from "./services/tags.js";
import { createSupermemoryTool } from "./tool/index.js";

export const SupermemoryPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory } = ctx;
  const tags = getTags(directory);
  const injectedSessions = new Set<string>();
  log("Plugin init", { directory, tags, configured: isConfigured() });

  if (!isConfigured()) {
    log("Plugin disabled - SUPERMEMORY_API_KEY not set");
  }

  // Fetch model limits once at plugin init
  const modelLimits = new Map<string, number>();

  (async () => {
    try {
      const response = await ctx.client.provider.list();
      if (response.data?.all) {
        for (const provider of response.data.all) {
          if (provider.models) {
            for (const [modelId, model] of Object.entries(provider.models)) {
              if (model.limit?.context) {
                modelLimits.set(`${provider.id}/${modelId}`, model.limit.context);
              }
            }
          }
        }
      }
      log("Model limits loaded", { count: modelLimits.size });
    } catch (error) {
      log("Failed to fetch model limits", { error: String(error) });
    }
  })();

  const getModelLimit = (providerID: string, modelID: string): number | undefined => {
    return modelLimits.get(`${providerID}/${modelID}`);
  };

  const compactionHook =
    isConfigured() && ctx.client
      ? createCompactionHook(ctx as CompactionContext, tags, {
          threshold: CONFIG.compactionThreshold,
          getModelLimit,
        })
      : null;

  return {
    "chat.message": (input, output) =>
      handleChatMessage(input, output, {
        client: supermemoryClient,
        config: CONFIG,
        tags,
        injectedSessions,
        log,
        isConfigured,
      }),

    tool: {
      supermemory: createSupermemoryTool({ tags, client: supermemoryClient }),
    },

    event: async (input: { event: { type: string; properties?: unknown } }) => {
      if (compactionHook) {
        await compactionHook.event(input);
      }
    },
  };
};
