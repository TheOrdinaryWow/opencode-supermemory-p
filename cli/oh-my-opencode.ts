import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findOpencodeConfig, OPENCODE_CONFIG_DIR } from "./opencode-config.js";

const OH_MY_OPENCODE_CONFIG = join(OPENCODE_CONFIG_DIR, "oh-my-opencode.json");
const HOOK_NAME = "anthropic-context-window-limit-recovery";

export function isOhMyOpencodeInstalled(): boolean {
  const configPath = findOpencodeConfig();
  if (!configPath) return false;

  try {
    const content = readFileSync(configPath, "utf-8");
    return content.includes("oh-my-opencode");
  } catch {
    return false;
  }
}

export function isAutoCompactAlreadyDisabled(): boolean {
  if (!existsSync(OH_MY_OPENCODE_CONFIG)) return false;

  try {
    const content = readFileSync(OH_MY_OPENCODE_CONFIG, "utf-8");
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

    if (existsSync(OH_MY_OPENCODE_CONFIG)) {
      const content = readFileSync(OH_MY_OPENCODE_CONFIG, "utf-8");
      config = JSON.parse(content);
    }

    const disabledHooks = (config.disabled_hooks as string[]) || [];
    if (!disabledHooks.includes(HOOK_NAME)) {
      disabledHooks.push(HOOK_NAME);
    }
    config.disabled_hooks = disabledHooks;

    writeFileSync(OH_MY_OPENCODE_CONFIG, JSON.stringify(config, null, 2));
    console.log(`✓ Disabled ${HOOK_NAME} hook in oh-my-opencode.json`);
    return true;
  } catch (err) {
    console.error("✗ Failed to update oh-my-opencode.json:", err);
    return false;
  }
}
