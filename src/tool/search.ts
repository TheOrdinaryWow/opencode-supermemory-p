import { formatSearchResults } from "@/tool/format";
import type { ToolArgs, ToolDeps } from "@/tool/index";

export async function executeSearch(args: ToolArgs, deps: ToolDeps): Promise<string> {
  if (!args.query) {
    return JSON.stringify({
      success: false,
      error: "query parameter is required for search mode",
    });
  }

  const scope = args.scope;

  if (scope === "user") {
    const result = await deps.client.searchMemories(args.query, deps.tags.user);
    if (!result.success) {
      return JSON.stringify({
        success: false,
        error: result.error || "Failed to search memories",
      });
    }
    return formatSearchResults(args.query, scope, result, args.limit);
  }

  if (scope === "project") {
    const result = await deps.client.searchMemories(args.query, deps.tags.project);
    if (!result.success) {
      return JSON.stringify({
        success: false,
        error: result.error || "Failed to search memories",
      });
    }
    return formatSearchResults(args.query, scope, result, args.limit);
  }

  const [userResult, projectResult] = await Promise.all([
    deps.client.searchMemories(args.query, deps.tags.user),
    deps.client.searchMemories(args.query, deps.tags.project),
  ]);

  if (!userResult.success || !projectResult.success) {
    const errorMessage =
      (!userResult.success ? userResult.error : undefined) ||
      (!projectResult.success ? projectResult.error : undefined) ||
      "Failed to search memories";
    return JSON.stringify({
      success: false,
      error: errorMessage,
    });
  }

  const combined = [
    ...(userResult.results || []).map((r) => ({
      ...r,
      scope: "user" as const,
    })),
    ...(projectResult.results || []).map((r) => ({
      ...r,
      scope: "project" as const,
    })),
  ].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));

  return JSON.stringify({
    success: true,
    query: args.query,
    count: combined.length,
    results: combined.slice(0, args.limit || 10).map((r) => ({
      id: r.id,
      content: r.memory || r.chunk,
      similarity: Math.round((r.similarity ?? 0) * 100),
      scope: r.scope,
    })),
  });
}
