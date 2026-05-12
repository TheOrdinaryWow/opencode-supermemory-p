import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const TEMPLATE_DIR = join(REPO_ROOT, "cli", "templates");
const CLI_PATH = join(REPO_ROOT, "dist", "cli.js");
const BASELINE_HELP = readFileSync(join(REPO_ROOT, "tests", "fixtures", "baseline", "cli-help.txt"), "utf-8");

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  home: string;
}

async function runCli(args: string[], setup?: (home: string) => void): Promise<CliResult> {
  const home = createTmpDir("cli");
  try {
    setup?.(home);
    const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: home };
    delete env.SUPERMEMORY_API_KEY;

    const proc = Bun.spawn(["node", CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    return { exitCode: proc.exitCode ?? -1, stdout, stderr, home };
  } catch (error) {
    cleanupTmpDir(home);
    throw error;
  }
}

function cleanupCliResult(result: CliResult): void {
  cleanupTmpDir(result.home);
}

function writeCredentials(home: string): void {
  const dir = join(home, ".supermemory-opencode");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "credentials.json"), JSON.stringify({ apiKey: "sm_test_cli", createdAt: "2026-01-01T00:00:00.000Z" }));
}

function expectInstalledCommandToMatchTemplate(home: string, name: string): void {
  const templatePath = join(TEMPLATE_DIR, `${name}.md`);
  const installedPath = join(home, ".config", "opencode", "command", `${name}.md`);
  expect(readFileSync(installedPath, "utf-8")).toBe(readFileSync(templatePath, "utf-8"));
}

describe("CLI commands", () => {
  it("prints the baseline help text", async () => {
    const result = await runCli(["--help"]);
    try {
      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(`${result.stdout}EXIT=${result.exitCode}\n`).toBe(BASELINE_HELP);
      expect(result.stderr).toBe("");
    } finally {
      cleanupCliResult(result);
    }
  });

  it("install --no-tui --disable-context-recovery creates OpenCode config and commands", async () => {
    const result = await runCli(["install", "--no-tui", "--disable-context-recovery"]);
    try {
      expect(result.exitCode).toBe(0);
      const configPath = join(result.home, ".config", "opencode", "opencode.jsonc");
      const commandDir = join(result.home, ".config", "opencode", "command");
      expect(existsSync(configPath)).toBe(true);
      expect(readFileSync(configPath, "utf-8")).toContain("opencode-supermemory@latest");
      expect(existsSync(join(commandDir, "supermemory-init.md"))).toBe(true);
      expect(existsSync(join(commandDir, "supermemory-login.md"))).toBe(true);
      expect(existsSync(join(commandDir, "supermemory-logout.md"))).toBe(true);
      expectInstalledCommandToMatchTemplate(result.home, "supermemory-init");
      expectInstalledCommandToMatchTemplate(result.home, "supermemory-login");
      expectInstalledCommandToMatchTemplate(result.home, "supermemory-logout");
      expect(result.stdout).toContain("Setup complete");
    } finally {
      cleanupCliResult(result);
    }
  });

  it("login exits without opening auth flow when credentials already exist", async () => {
    const result = await runCli(["login"], writeCredentials);
    try {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Already authenticated");
      expect(result.stderr).toBe("");
    } finally {
      cleanupCliResult(result);
    }
  });

  it("logout clears existing credentials", async () => {
    const result = await runCli(["logout"], writeCredentials);
    try {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Credentials cleared");
      expect(existsSync(join(result.home, ".supermemory-opencode", "credentials.json"))).toBe(false);
    } finally {
      cleanupCliResult(result);
    }
  });

  it("unknown commands exit non-zero and print help", async () => {
    const result = await runCli(["bogus-cmd"]);
    try {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown command: bogus-cmd");
      expect(result.stdout).toContain("opencode-supermemory - Persistent memory");
    } finally {
      cleanupCliResult(result);
    }
  });
});
