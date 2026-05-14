import type { ToolArgs, ToolDeps } from "@/tool/index";

export async function executeForget(args: ToolArgs, deps: ToolDeps): Promise<string> {
  if (!args.memoryId) {
    return JSON.stringify({
      success: false,
      error: "memoryId parameter is required for forget mode",
    });
  }

  const scope = args.scope || "project";
  const containerTag = scope === "user" ? deps.tags.user : deps.tags.project;

  const result = await deps.client.deleteMemory(args.memoryId, containerTag);

  if (!result.success) {
    return JSON.stringify({
      success: false,
      error: result.error || "Failed to delete memory",
    });
  }

  return JSON.stringify({
    success: true,
    message: `Memory ${args.memoryId} removed from ${scope} scope`,
  });
}
