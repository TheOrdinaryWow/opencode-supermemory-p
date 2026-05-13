import { isFullyPrivate, stripPrivateContent } from "@/memory/privacy";
import type { ToolArgs, ToolDeps } from "@/tool/index";

export async function executeAdd(args: ToolArgs, deps: ToolDeps): Promise<string> {
  if (!args.content) {
    return JSON.stringify({
      success: false,
      error: "content parameter is required for add mode",
    });
  }

  const sanitizedContent = stripPrivateContent(args.content);
  if (isFullyPrivate(args.content)) {
    return JSON.stringify({
      success: false,
      error: "Cannot store fully private content",
    });
  }

  const scope = args.scope || "project";
  const containerTag = scope === "user" ? deps.tags.user : deps.tags.project;

  const result = await deps.client.addMemory(sanitizedContent, containerTag, { type: args.type, source: "user" });

  if (!result.success) {
    return JSON.stringify({
      success: false,
      error: result.error || "Failed to add memory",
    });
  }

  return JSON.stringify({
    success: true,
    message: `Memory added to ${scope} scope`,
    id: result.id,
    scope,
    type: args.type,
  });
}
