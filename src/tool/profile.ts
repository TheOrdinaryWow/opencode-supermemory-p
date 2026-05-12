import type { ToolArgs, ToolDeps } from "./index.js";

export async function executeProfile(args: ToolArgs, deps: ToolDeps): Promise<string> {
  const result = await deps.client.getProfile(deps.tags.user, args.query);

  if (!result.success) {
    return JSON.stringify({
      success: false,
      error: result.error || "Failed to fetch profile",
    });
  }

  return JSON.stringify({
    success: true,
    profile: {
      static: result.profile?.static || [],
      dynamic: result.profile?.dynamic || [],
    },
  });
}
