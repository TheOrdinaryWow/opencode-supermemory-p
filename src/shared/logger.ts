import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getRotatingFileSink } from "@logtape/file";
import { configureSync, getLogger, isLogLevel, jsonLinesFormatter, type LogLevel, resetSync } from "@logtape/logtape";

/**
 * Default rotation policy for the plugin's log file.
 * 1 MiB per file × 5 files = 5 MiB hard cap on disk usage.
 */
const DEFAULT_MAX_SIZE = 1024 * 1024;
const DEFAULT_MAX_FILES = 5;

/**
 * Resolve the log file path. Read on every call so env / HOME changes
 * after module import are honoured — critical for testing under `Bun.spawn`
 * with a custom HOME and OPENCODE_SUPERMEMORY_LOG.
 */
function resolveLogPath(): string {
  return process.env.OPENCODE_SUPERMEMORY_LOG ?? join(homedir(), ".local", "share", "opencode-supermemory-p", "log", "main.log");
}

/**
 * Resolve the lowest log level. Accepts logtape's canonical names
 * (`trace`/`debug`/`info`/`warning`/`error`/`fatal`) plus the legacy alias
 * `warn` → `warning` for backwards compatibility with the pre-logtape logger.
 */
function resolveLogLevel(): LogLevel {
  const raw = process.env.OPENCODE_SUPERMEMORY_LOG_LEVEL?.toLowerCase();
  if (!raw) return "info";
  const normalized = raw === "warn" ? "warning" : raw;
  return isLogLevel(normalized) ? (normalized as LogLevel) : "info";
}

let configured = false;

/**
 * Configure LogTape once for the plugin. Idempotent — repeat calls are no-ops.
 * Safe to invoke from the plugin entry point's `createDeps()`.
 *
 * Wiring:
 *   - File sink: rotating, default 1 MiB × 5 files, path from env or `~/.local/share/opencode-supermemory-p/log/main.log`.
 *   - Plugin logger (`["supermemory"]`): lowestLevel from `OPENCODE_SUPERMEMORY_LOG_LEVEL`, default `"info"`.
 *   - Meta logger (`["logtape","meta"]`): pinned to `"warning"` so LogTape's own startup banner stays quiet.
 */
export function initLogger(): void {
  if (configured) return;
  const path = resolveLogPath();
  mkdirSync(dirname(path), { recursive: true });
  configureSync({
    reset: true,
    sinks: {
      file: getRotatingFileSink(path, {
        maxSize: DEFAULT_MAX_SIZE,
        maxFiles: DEFAULT_MAX_FILES,
        formatter: jsonLinesFormatter,
      }),
    },
    loggers: [
      { category: ["supermemory"], lowestLevel: resolveLogLevel(), sinks: ["file"] },
      { category: ["logtape", "meta"] } /** disable logtape logger */,
    ],
  });
  configured = true;
}

/**
 * Tear down LogTape configuration. Mainly for tests that need to re-init
 * with different env. Safe to call when not configured.
 */
export function resetLogger(): void {
  if (!configured) return;
  resetSync();
  configured = false;
}

/**
 * Convenience root logger for code that does not need a sub-category.
 * Sub-modules should call `getLogger(["supermemory", "<module>"])` directly
 * from `@logtape/logtape` instead.
 */
export const rootLogger = getLogger(["supermemory"]);
