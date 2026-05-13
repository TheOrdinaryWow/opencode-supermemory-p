import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findOpencodeConfig, OPENCODE_CONFIG_DIR } from "@cli/opencode-config";

const OH_MY_OPENAGENT_CONFIG = (() => {
  const configFileList = ["oh-my-openagent.jsonc", "oh-my-openagent.json", "oh-my-opencode.jsonc", "oh-my-opencode.json"];
  const configList = configFileList.map((file) => join(OPENCODE_CONFIG_DIR, file));

  return configList.find(existsSync) || join(OPENCODE_CONFIG_DIR, "oh-my-opencode.json");
})();

const HOOK_NAME = "anthropic-context-window-limit-recovery";

export function isOhMyOpenAgentInstalled(): boolean {
  const configPath = findOpencodeConfig();
  if (!configPath) return false;

  try {
    const content = readFileSync(configPath, "utf-8");
    return ["oh-my-openagent", "oh-my-opencode"].some((keyword) => content.includes(keyword));
  } catch {
    return false;
  }
}

export function isAutoCompactAlreadyDisabled(): boolean {
  if (!existsSync(OH_MY_OPENAGENT_CONFIG)) return false;

  try {
    const content = readFileSync(OH_MY_OPENAGENT_CONFIG, "utf-8");
    const config = JSON.parse(content);
    const disabledHooks = config.disabled_hooks as string[] | undefined;
    return disabledHooks?.includes(HOOK_NAME) ?? false;
  } catch {
    return false;
  }
}

export function disableAutoCompactHook(): boolean {
  try {
    let config: Record<string, unknown> = {};
    let configFileName: string | null = null;

    if (existsSync(OH_MY_OPENAGENT_CONFIG)) {
      configFileName = OH_MY_OPENAGENT_CONFIG.split("/").pop() || null;
      const content = readFileSync(OH_MY_OPENAGENT_CONFIG, "utf-8");
      config = JSON.parse(content);
    }

    const disabledHooks = (config.disabled_hooks as string[]) || [];
    if (!disabledHooks.includes(HOOK_NAME)) {
      disabledHooks.push(HOOK_NAME);
    }
    config.disabled_hooks = disabledHooks;

    writeFileSync(OH_MY_OPENAGENT_CONFIG, JSON.stringify(config, null, 2));
    console.log(`✓ Disabled ${HOOK_NAME} hook in ${configFileName || "default omo config file"}`);
    return true;
  } catch (err) {
    console.error("✗ Failed to update omo config file:", err);
    return false;
  }
}
