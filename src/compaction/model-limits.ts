import type { PluginInput } from "@opencode-ai/plugin";

export function createModelLimitLookup(ctx: PluginInput, log: (message: string, data?: unknown) => void): (providerID: string, modelID: string) => number | undefined {
  const modelLimits = new Map<string, number>();
  (async () => {
    try {
      const response = await ctx.client.provider.list();
      for (const provider of response.data?.all ?? []) {
        for (const [modelId, model] of Object.entries(provider.models ?? {})) {
          if (model.limit?.context) modelLimits.set(`${provider.id}/${modelId}`, model.limit.context);
        }
      }
      log("Model limits loaded", { count: modelLimits.size });
    } catch (error) {
      log("Failed to fetch model limits", { error: String(error) });
    }
  })();
  return (providerID: string, modelID: string) => modelLimits.get(`${providerID}/${modelID}`);
}
