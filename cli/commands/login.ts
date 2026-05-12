import { defineCommand } from "citty";

import { loadCredentials } from "../../src/auth/credentials.js";
import { startAuthFlow } from "../../src/auth/flow.js";

export async function runLoginFlow(): Promise<number> {
  const existing = loadCredentials();
  if (existing) {
    console.log("Already authenticated. Use 'logout' first to re-authenticate.");
    return 0;
  }

  const result = await startAuthFlow();

  if (result.success) {
    console.log("\n✓ Successfully authenticated with Supermemory!");
    console.log("Restart OpenCode to activate.\n");
    return 0;
  }

  console.error(`\n✗ Authentication failed: ${result.error}`);
  return 1;
}

export default defineCommand({
  meta: { name: "login", description: "Authenticate with Supermemory (opens browser)" },
  async run() {
    process.exit(await runLoginFlow());
  },
});
