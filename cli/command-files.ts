import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { OPENCODE_CONFIG_DIR } from "@cli/opencode-config";

const OPENCODE_COMMAND_DIR = join(OPENCODE_CONFIG_DIR, "command");

function readTemplate(name: string): string {
  return readFileSync(new URL(`./templates/${name}`, import.meta.url), "utf-8");
}

export function createCommandFiles(): boolean {
  mkdirSync(OPENCODE_COMMAND_DIR, { recursive: true });

  writeFileSync(join(OPENCODE_COMMAND_DIR, "supermemory-init.md"), readTemplate("supermemory-init.md"));
  console.log(`✓ Created /supermemory-init command`);

  writeFileSync(join(OPENCODE_COMMAND_DIR, "supermemory-login.md"), readTemplate("supermemory-login.md"));
  console.log(`✓ Created /supermemory-login command`);

  writeFileSync(join(OPENCODE_COMMAND_DIR, "supermemory-logout.md"), readTemplate("supermemory-logout.md"));
  console.log(`✓ Created /supermemory-logout command`);

  return true;
}
