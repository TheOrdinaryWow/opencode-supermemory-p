import type { ToolArgs, ToolDeps } from "@/tool/index";

export async function executeList(args: ToolArgs, deps: ToolDeps): Promise<string> {
  const scope = args.scope || "project";
  const limit = args.limit || 20;
  const containerTag = scope === "user" ? deps.tags.user : deps.tags.project;

  const result = await deps.client.listMemories(containerTag, limit);

  if (!result.success) {
    return JSON.stringify({
      success: false,
      error: result.error || "Failed to list memories",
    });
  }

  const memories = result.memories || [];
  return JSON.stringify({
    success: true,
    scope,
    count: memories.length,
    memories: memories.map((m) => ({
      id: m.id,
      content: m.summary,
      createdAt: m.createdAt,
      metadata: m.metadata,
    })),
  });
}
