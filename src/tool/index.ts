import { tool } from "@opencode-ai/plugin";

import { getConfig } from "@/config/loader";
import type { supermemoryClient } from "@/memory/client";
import type { MemoryScope, MemoryType } from "@/types/index";
import { executeAdd } from "@/tool/add";
import { executeForget } from "@/tool/forget";
import { executeList } from "@/tool/list";
import { executeProfile } from "@/tool/profile";
import { executeSearch } from "@/tool/search";

export type ToolDeps = {
  tags: { user: string; project: string };
  client: typeof supermemoryClient;
};

export type ToolArgs = {
  mode?: string;
  content?: string;
  query?: string;
  type?: MemoryType;
  scope?: MemoryScope;
  memoryId?: string;
  limit?: number;
};

const HELP_RESPONSE = JSON.stringify({
  success: true,
  message: "Supermemory Usage Guide",
  commands: [
    { command: "add", description: "Store a new memory", args: ["content", "type?", "scope?"] },
    { command: "search", description: "Search memories", args: ["query", "scope?"] },
    { command: "profile", description: "View user profile", args: ["query?"] },
    { command: "list", description: "List recent memories", args: ["scope?", "limit?"] },
    { command: "forget", description: "Remove a memory", args: ["memoryId", "scope?"] },
  ],
  scopes: {
    user: "Cross-project preferences and knowledge",
    project: "Project-specific knowledge (default)",
  },
  types: ["project-config", "architecture", "error-solution", "preference", "learned-pattern", "conversation"],
});

export function createSupermemoryTool(deps: ToolDeps): ReturnType<typeof tool> {
  return tool({
    description:
      "Manage and query the Supermemory persistent memory system. Use 'search' to find relevant memories, 'add' to store new knowledge, 'profile' to view user profile, 'list' to see recent memories, 'forget' to remove a memory.",
    args: {
      mode: tool.schema.enum(["add", "search", "profile", "list", "forget", "help"]).optional(),
      content: tool.schema.string().optional(),
      query: tool.schema.string().optional(),
      type: tool.schema
        .enum(["project-config", "architecture", "error-solution", "preference", "learned-pattern", "conversation"])
        .optional(),
      scope: tool.schema.enum(["user", "project"]).optional(),
      memoryId: tool.schema.string().optional(),
      limit: tool.schema.number().optional(),
    },
    async execute(args: ToolArgs) {
      if (!getConfig().apiKey) {
        return JSON.stringify({
          success: false,
          error: "SUPERMEMORY_API_KEY not set. Set it in your environment to use Supermemory.",
        });
      }
      const mode = args.mode || "help";
      try {
        switch (mode) {
          case "help":
            return HELP_RESPONSE;
          case "add":
            return await executeAdd(args, deps);
          case "search":
            return await executeSearch(args, deps);
          case "profile":
            return await executeProfile(args, deps);
          case "list":
            return await executeList(args, deps);
          case "forget":
            return await executeForget(args, deps);
          default:
            return JSON.stringify({ success: false, error: `Unknown mode: ${mode}` });
        }
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}
