#!/usr/bin/env node
import installCommand, { setupCommand } from "@cli/commands/install";
import loginCommand from "@cli/commands/login";
import logoutCommand from "@cli/commands/logout";
import versionCommand, { PACKAGE_NAME, VERSION } from "@cli/commands/version";
import { defineCommand, runMain } from "citty";

const HELP = `
opencode-supermemory-p - The powered Supermemory plugin for OpenCode

Commands:
  install    Install and configure the plugin
    --no-tui                     Non-interactive mode (for LLM agents)
    --disable-context-recovery   Disable Oh My OpenAgent's context hook
  login      Authenticate with Supermemory (opens browser)
  logout     Clear stored credentials
  version    Show the installed version

Flags:
  -v, --version  Show the installed version

Examples:
  bunx opencode-supermemory-p@latest install
  bunx opencode-supermemory-p@latest login
  bunx opencode-supermemory-p@latest logout
  bunx opencode-supermemory-p@latest version
`;

const first = process.argv[2];
const known = ["install", "setup", "login", "logout", "version"];
if (!first || first === "help" || first === "--help" || first === "-h") {
  console.log(HELP);
  process.exit(0);
}
if (first === "--version" || first === "-v") {
  console.log(`${PACKAGE_NAME} ${VERSION}`);
  process.exit(0);
}
if (!known.includes(first)) {
  console.error(`Unknown command: ${first}`);
  console.log(HELP);
  process.exit(1);
}

runMain(
  defineCommand({
    meta: { name: "opencode-supermemory-p" },
    subCommands: { install: installCommand, login: loginCommand, logout: logoutCommand, setup: setupCommand, version: versionCommand },
  }),
);
