import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { useTmpDir } from "../helpers/tmpdir";

const LOGGER_MODULE_ABS = resolve(import.meta.dir, "../../src/shared/logger.ts");

/**
 * Spawn a fresh `bun -e` subprocess with the given env. LogTape is
 * configured globally per-process, so test isolation requires a fresh
 * process for each scenario.
 */
function spawnScript(script: string, env: Record<string, string>): { exitCode: number; stderr: string; stdout: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", "-e", script],
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode ?? -1,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

describe("logger: import is side-effect-free", () => {
  const tmp = useTmpDir("logger-side-effect");

  it("importing the module does not create any log file", () => {
    const explicitLog = join(tmp, "explicit.log");
    const defaultLog = join(tmp, ".local", "share", "opencode-supermemory-p", "log", "main.log"); // resolved via HOME=tmp

    const script = `await import(${JSON.stringify(LOGGER_MODULE_ABS)});`;
    const { exitCode, stderr } = spawnScript(script, {
      HOME: tmp,
      OPENCODE_SUPERMEMORY_LOG: explicitLog,
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    // Neither the env-pointed log nor the HOME-resolved default appeared.
    expect(existsSync(explicitLog)).toBe(false);
    expect(existsSync(defaultLog)).toBe(false);
  });
});

describe("initLogger: opens the file lazily on first call", () => {
  const tmp = useTmpDir("logger-init");

  it("creates the log file when initLogger() runs and emits a record", () => {
    const logPath = join(tmp, "init.log");
    const script = `
      const m = await import(${JSON.stringify(LOGGER_MODULE_ABS)});
      m.initLogger();
      m.rootLogger.info("hello-from-init");
    `;
    const { exitCode, stderr } = spawnScript(script, {
      HOME: tmp,
      OPENCODE_SUPERMEMORY_LOG: logPath,
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, "utf-8")).toContain("hello-from-init");
  });

  it("category-scoped loggers under ['supermemory'] flow through to the same file", () => {
    const logPath = join(tmp, "sub.log");
    const script = `
      const tape = await import("@logtape/logtape");
      const m = await import(${JSON.stringify(LOGGER_MODULE_ABS)});
      m.initLogger();
      tape.getLogger(["supermemory", "memory", "client"]).error("subcat-msg", { code: 42 });
    `;
    const { exitCode } = spawnScript(script, {
      HOME: tmp,
      OPENCODE_SUPERMEMORY_LOG: logPath,
    });

    expect(exitCode).toBe(0);
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("subcat-msg");
    // jsonLinesFormatter joins the category with '.' and renders level in uppercase
    expect(content).toContain("supermemory.memory.client");
    expect(content).toContain('"level":"ERROR"');
    // structured properties survive end-to-end (key motivation for jsonLines)
    expect(content).toContain('"properties":{"code":42}');
    // each line is valid NDJSON
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

describe("initLogger: level filtering via OPENCODE_SUPERMEMORY_LOG_LEVEL", () => {
  const tmp = useTmpDir("logger-level");

  it("level=warning drops info, keeps warning and above", () => {
    const logPath = join(tmp, "level-warning.log");
    const script = `
      const m = await import(${JSON.stringify(LOGGER_MODULE_ABS)});
      m.initLogger();
      m.rootLogger.info("hidden-info");
      m.rootLogger.warn("shown-warn");
      m.rootLogger.error("shown-error");
    `;
    const { exitCode } = spawnScript(script, {
      HOME: tmp,
      OPENCODE_SUPERMEMORY_LOG: logPath,
      OPENCODE_SUPERMEMORY_LOG_LEVEL: "warning",
    });

    expect(exitCode).toBe(0);
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("shown-warn");
    expect(content).toContain("shown-error");
    expect(content).not.toContain("hidden-info");
  });

  it("legacy 'warn' alias maps to 'warning'", () => {
    const logPath = join(tmp, "level-legacy.log");
    const script = `
      const m = await import(${JSON.stringify(LOGGER_MODULE_ABS)});
      m.initLogger();
      m.rootLogger.info("dropped");
      m.rootLogger.warn("kept");
    `;
    spawnScript(script, {
      HOME: tmp,
      OPENCODE_SUPERMEMORY_LOG: logPath,
      OPENCODE_SUPERMEMORY_LOG_LEVEL: "warn",
    });

    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("kept");
    expect(content).not.toContain("dropped");
  });

  it("invalid level falls back to info (debug dropped, info kept)", () => {
    const logPath = join(tmp, "level-bogus.log");
    const script = `
      const m = await import(${JSON.stringify(LOGGER_MODULE_ABS)});
      m.initLogger();
      m.rootLogger.debug("debug-dropped");
      m.rootLogger.info("info-kept");
    `;
    spawnScript(script, {
      HOME: tmp,
      OPENCODE_SUPERMEMORY_LOG: logPath,
      OPENCODE_SUPERMEMORY_LOG_LEVEL: "definitely-not-a-level",
    });

    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("info-kept");
    expect(content).not.toContain("debug-dropped");
  });
});

describe("initLogger: idempotency", () => {
  const tmp = useTmpDir("logger-idempotent");

  it("multiple initLogger() calls do not re-configure or duplicate output", () => {
    const logPath = join(tmp, "idem.log");
    const script = `
      const m = await import(${JSON.stringify(LOGGER_MODULE_ABS)});
      m.initLogger();
      m.initLogger();
      m.initLogger();
      m.rootLogger.info("once");
    `;
    const { exitCode } = spawnScript(script, {
      HOME: tmp,
      OPENCODE_SUPERMEMORY_LOG: logPath,
    });

    expect(exitCode).toBe(0);
    const content = readFileSync(logPath, "utf-8");
    const occurrences = content.match(/once/g)?.length ?? 0;
    expect(occurrences).toBe(1);
  });
});

describe("resetLogger: allows re-configuration", () => {
  const tmp = useTmpDir("logger-reset");

  it("calling resetLogger() then initLogger() with new env picks up the new path", () => {
    const firstPath = join(tmp, "first.log");
    const secondPath = join(tmp, "second.log");
    const script = `
      const m = await import(${JSON.stringify(LOGGER_MODULE_ABS)});
      m.initLogger();
      m.rootLogger.info("to-first");
      m.resetLogger();
      process.env.OPENCODE_SUPERMEMORY_LOG = ${JSON.stringify(secondPath)};
      m.initLogger();
      m.rootLogger.info("to-second");
    `;
    const { exitCode } = spawnScript(script, {
      HOME: tmp,
      OPENCODE_SUPERMEMORY_LOG: firstPath,
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(firstPath, "utf-8")).toContain("to-first");
    expect(readFileSync(firstPath, "utf-8")).not.toContain("to-second");
    expect(readFileSync(secondPath, "utf-8")).toContain("to-second");
  });
});
