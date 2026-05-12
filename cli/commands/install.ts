import { defineCommand } from "citty";
import type { Interface } from "node:readline";

import { createCommandFiles } from "../command-files.js";
import { disableAutoCompactHook, isAutoCompactAlreadyDisabled, isOhMyOpencodeInstalled } from "../oh-my-opencode.js";
import { addPluginToConfig, createNewConfig, findOpencodeConfig } from "../opencode-config.js";
import { confirm, createReadline } from "../prompts.js";
import { runLoginFlow } from "./login.js";

async function maybe(rl: Interface | null, q: string, action: () => void): Promise<void> {
  if (!rl) return action();
  if (await confirm(rl, q)) action();
  else console.log("Skipped.");
}

async function runInstall(tui: boolean, disableAutoCompact: boolean): Promise<number> {
  console.log("\n🧠 opencode-supermemory installer\n");
  const rl = tui ? createReadline() : null;

  console.log("Step 1: Register plugin in OpenCode config");
  const configPath = findOpencodeConfig();
  if (configPath) await maybe(rl, `Add plugin to ${configPath}?`, () => addPluginToConfig(configPath));
  else await maybe(rl, "No OpenCode config found. Create one?", createNewConfig);

  console.log("\nStep 2: Create /supermemory-init, /supermemory-login, and /supermemory-logout commands");
  await maybe(rl, "Add supermemory commands?", createCommandFiles);

  if (isOhMyOpencodeInstalled()) {
    console.log("\nStep 3: Configure Oh My OpenCode");
    console.log("Detected Oh My OpenCode plugin.");
    console.log("Supermemory handles context compaction, so the built-in context-window-limit-recovery hook should be disabled.");
    if (isAutoCompactAlreadyDisabled()) console.log("✓ anthropic-context-window-limit-recovery hook already disabled");
    else if (rl) await maybe(rl, "Disable anthropic-context-window-limit-recovery hook to let Supermemory handle context?", disableAutoCompactHook);
    else if (disableAutoCompact) disableAutoCompactHook();
    else console.log("Skipped. Use --disable-context-recovery to disable the hook in non-interactive mode.");
  }

  if (rl) rl.close();
  console.log(`\n${"─".repeat(50)}`);
  console.log("\n🔑 Final step: Authenticate with Supermemory\n");
  if (tui) return runLoginFlow();
  console.log("Run this command to authenticate:");
  console.log("  bunx opencode-supermemory@latest login");
  console.log("\nOr set your API key manually:");
  console.log('  export SUPERMEMORY_API_KEY="sm_..."');
  console.log(`\n${"─".repeat(50)}`);
  console.log("\n✓ Setup complete! Restart OpenCode to activate.\n");
  return 0;
}

const installArgs = {
  "no-tui": { type: "boolean" as const, description: "Non-interactive mode (for LLM agents)" },
  "disable-context-recovery": { type: "boolean" as const, description: "Disable Oh My OpenCode's context hook" },
};

export default defineCommand({
  meta: { name: "install", description: "Install and configure the plugin" },
  args: installArgs,
  async run({ args }) {
    process.exit(await runInstall(args.tui !== false, !!args["disable-context-recovery"]));
  },
});

export const setupCommand = defineCommand({
  meta: { name: "setup", description: "Deprecated alias for 'install'" },
  args: installArgs,
  async run({ args }) {
    console.log("Note: 'setup' is deprecated. Use 'install' instead.\n");
    process.exit(await runInstall(args.tui !== false, !!args["disable-context-recovery"]));
  },
});
