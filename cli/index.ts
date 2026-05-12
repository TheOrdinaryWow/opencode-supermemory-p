#!/usr/bin/env node
import { defineCommand, runMain } from "citty";

import installCommand, { setupCommand } from "./commands/install.js";
import loginCommand from "./commands/login.js";
import logoutCommand from "./commands/logout.js";

const HELP = `
opencode-supermemory - Persistent memory for OpenCode agents

Commands:
  install    Install and configure the plugin
    --no-tui                     Non-interactive mode (for LLM agents)
    --disable-context-recovery   Disable Oh My OpenCode's context hook
  login      Authenticate with Supermemory (opens browser)
  logout     Clear stored credentials

Examples:
  bunx opencode-supermemory@latest install
  bunx opencode-supermemory@latest login
  bunx opencode-supermemory@latest logout
`;

const first = process.argv[2];
const known = ["install", "setup", "login", "logout"];
if (!first || first === "help" || first === "--help" || first === "-h") {
  console.log(HELP);
  process.exit(0);
}
if (!known.includes(first)) {
  console.error(`Unknown command: ${first}`);
  console.log(HELP);
  process.exit(1);
}

runMain(
  defineCommand({
    meta: { name: "opencode-supermemory" },
    subCommands: { install: installCommand, login: loginCommand, logout: logoutCommand, setup: setupCommand },
  }),
);
