import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createLogger } from "@/shared/logger";

import { useTmpDir } from "../helpers/tmpdir";

const LOGGER_MODULE_ABS = resolve(import.meta.dir, "../../src/shared/logger.ts");

/**
 * Spawn a fresh `bun -e` subprocess with the given env. Used to exercise
 * module-load behaviour (no side effects) and `defaultLogger` / `initLogger`,
 * which read `process.env` lazily — running them in-process would risk
 * cross-file env leakage with Bun's parallel test runner.
 */
function spawnScript(script: string, env: Record<string, string>): { exitCode: number; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", "-e", script],
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode ?? -1,
    stderr: result.stderr.toString(),
  };
}

describe("logger: import is side-effect-free", () => {
  const tmp = useTmpDir("logger-side-effect");

  it("importing the module does not create any log file", () => {
    const explicitLog = join(tmp, "explicit.log");
    const defaultLog = join(tmp, ".opencode-supermemory-p.log"); // resolved via HOME=tmp

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

describe("createLogger: lazy file open", () => {
  const tmp = useTmpDir("logger-lazy");

  it("does not touch the filesystem until a log method is called", () => {
    const logPath = join(tmp, "lazy.log");
    const logger = createLogger({ filePath: logPath });
    expect(existsSync(logPath)).toBe(false);

    logger.info("kick");
    expect(existsSync(logPath)).toBe(true);
  });
});

describe("createLogger: level filtering", () => {
  const tmp = useTmpDir("logger-level");

  it("drops messages below the configured minimum level", () => {
    const logPath = join(tmp, "warn-min.log");
    const logger = createLogger({ filePath: logPath, level: "warn" });

    logger.debug("d");
    logger.info("i");
    expect(existsSync(logPath)).toBe(false);

    logger.warn("w");
    logger.error("e");
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("[WARN] w");
    expect(content).toContain("[ERROR] e");
    expect(content).not.toContain("[DEBUG]");
    expect(content).not.toContain("[INFO]");
  });

  it("defaults to level=info (debug dropped, info kept)", () => {
    const logPath = join(tmp, "default-min.log");
    const logger = createLogger({ filePath: logPath });

    logger.debug("d");
    expect(existsSync(logPath)).toBe(false);

    logger.info("i");
    expect(readFileSync(logPath, "utf-8")).toContain("[INFO] i");
  });
});

describe("createLogger: output format", () => {
  const tmp = useTmpDir("logger-format");

  it("emits `[ISO] [LEVEL] message` when no data is attached", () => {
    const logPath = join(tmp, "bare.log");
    createLogger({ filePath: logPath }).info("hello world");
    const content = readFileSync(logPath, "utf-8");
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] hello world\n$/);
  });

  it("appends `JSON.stringify(data)` when data is provided", () => {
    const logPath = join(tmp, "data.log");
    createLogger({ filePath: logPath }).error("oops", { code: 42, reason: "boom" });
    const content = readFileSync(logPath, "utf-8");
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[ERROR\] oops \{"code":42,"reason":"boom"\}\n$/);
  });
});

describe("defaultLogger: env-driven destination", () => {
  const tmp = useTmpDir("logger-default");

  it("writes to OPENCODE_SUPERMEMORY_LOG when set", () => {
    const logPath = join(tmp, "default.log");
    const script = `
      const m = await import(${JSON.stringify(LOGGER_MODULE_ABS)});
      m.defaultLogger.info("default-hit", { ok: true });
    `;
    const { exitCode, stderr } = spawnScript(script, {
      HOME: tmp,
      OPENCODE_SUPERMEMORY_LOG: logPath,
    });
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(readFileSync(logPath, "utf-8")).toMatch(/\[INFO\] default-hit \{"ok":true\}/);
  });

  it("respects OPENCODE_SUPERMEMORY_LOG_LEVEL=warn (drops info)", () => {
    const logPath = join(tmp, "default-level.log");
    const script = `
      const m = await import(${JSON.stringify(LOGGER_MODULE_ABS)});
      m.defaultLogger.info("hidden");
      m.defaultLogger.warn("shown");
    `;
    const { exitCode } = spawnScript(script, {
      HOME: tmp,
      OPENCODE_SUPERMEMORY_LOG: logPath,
      OPENCODE_SUPERMEMORY_LOG_LEVEL: "warn",
    });
    expect(exitCode).toBe(0);
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("[WARN] shown");
    expect(content).not.toContain("hidden");
  });
});

describe("initLogger: explicit session header", () => {
  const tmp = useTmpDir("logger-init");

  it("writes a session-start marker to the default destination", () => {
    const logPath = join(tmp, "init.log");
    const script = `
      const m = await import(${JSON.stringify(LOGGER_MODULE_ABS)});
      m.initLogger();
    `;
    const { exitCode } = spawnScript(script, {
      HOME: tmp,
      OPENCODE_SUPERMEMORY_LOG: logPath,
    });
    expect(exitCode).toBe(0);
    expect(readFileSync(logPath, "utf-8")).toMatch(/^\n--- Session started: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z ---\n$/);
  });
});
