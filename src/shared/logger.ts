import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Log levels in ascending severity. A logger configured with `level: "warn"`
 * silently drops `.debug()` and `.info()` calls.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface LoggerOptions {
  /**
   * Absolute file path to append log lines to. When omitted, resolves to
   * `process.env.OPENCODE_SUPERMEMORY_LOG ?? ~/.opencode-supermemory-p.log`
   * lazily at first write (not at construction time).
   */
  filePath?: string;
  /** Minimum level that gets written. Defaults to `"info"`. */
  level?: LogLevel;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const VALID_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

/**
 * Resolve the default log file path. Read on every call so env / HOME changes
 * after module import are honoured — critical for testing under `Bun.spawn`
 * with a custom HOME and OPENCODE_SUPERMEMORY_LOG.
 */
function resolveDefaultPath(): string {
  return process.env.OPENCODE_SUPERMEMORY_LOG ?? join(homedir(), ".opencode-supermemory-p.log");
}

function resolveDefaultLevel(): LogLevel {
  const env = process.env.OPENCODE_SUPERMEMORY_LOG_LEVEL?.toLowerCase();
  if (env && VALID_LEVELS.has(env as LogLevel)) return env as LogLevel;
  return "info";
}

function formatLine(level: LogLevel, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const label = level.toUpperCase();
  if (data === undefined) return `[${timestamp}] [${label}] ${message}\n`;
  return `[${timestamp}] [${label}] ${message} ${JSON.stringify(data)}\n`;
}

/**
 * Creates an isolated logger. Construction is pure — no file is opened or
 * written until the first `.debug()` / `.info()` / `.warn()` / `.error()`
 * call. This is the property the architecture refactor is preserving:
 * importing this module from a plugin entry point must not leave artifacts
 * on disk.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const minRank = LEVEL_RANK[opts.level ?? "info"];
  const explicitPath = opts.filePath;

  function write(level: LogLevel, message: string, data?: unknown): void {
    if (LEVEL_RANK[level] < minRank) return;
    const target = explicitPath ?? resolveDefaultPath();
    appendFileSync(target, formatLine(level, message, data));
  }

  return {
    debug(message, data) {
      write("debug", message, data);
    },
    info(message, data) {
      write("info", message, data);
    },
    warn(message, data) {
      write("warn", message, data);
    },
    error(message, data) {
      write("error", message, data);
    },
  };
}

/**
 * Default singleton logger. Reads `OPENCODE_SUPERMEMORY_LOG` and
 * `OPENCODE_SUPERMEMORY_LOG_LEVEL` from the environment on every call, so
 * processes that mutate env (or are spawned with a custom env) see the
 * right destination without re-importing.
 */
export const defaultLogger: Logger = {
  debug(message, data) {
    writeDefault("debug", message, data);
  },
  info(message, data) {
    writeDefault("info", message, data);
  },
  warn(message, data) {
    writeDefault("warn", message, data);
  },
  error(message, data) {
    writeDefault("error", message, data);
  },
};

function writeDefault(level: LogLevel, message: string, data?: unknown): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[resolveDefaultLevel()]) return;
  appendFileSync(resolveDefaultPath(), formatLine(level, message, data));
}

/**
 * Writes a session-start header to the default log file. The plugin entry
 * point is expected to call this exactly once during initialisation — this
 * replaces the old `import`-time side effect.
 */
export function initLogger(): void {
  const line = `\n--- Session started: ${new Date().toISOString()} ---\n`;
  appendFileSync(resolveDefaultPath(), line);
}
