import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { loadCredentials } from "@/auth/credentials";
import { DEFAULT_KEYWORD_PATTERNS } from "@/config/defaults";
import { type SupermemoryConfig, SupermemoryConfigSchema } from "@/config/schema";
import { parseJsonc } from "@/shared/jsonc";

/**
 * Optional dependency-injection knobs for `loadConfig`.
 *
 * Tests rarely need to pass these: the existing test suite uses
 * `Bun.spawn(["bun", "-e", ...], { env: { HOME: tmpHome, ... } })` to redirect
 * `homedir()` and the env. The hooks below exist for future in-process tests
 * and for callers that need to load config from a non-default location.
 */
export interface LoadConfigOptions {
  /** Override `process.env`. Defaults to the live process env. */
  env?: NodeJS.ProcessEnv;
  /** Override `homedir()`. Defaults to the OS-reported home directory. */
  homeDir?: string;
}

let cachedConfig: SupermemoryConfig | null = null;

/**
 * Returns the cached resolved config, loading it on first call. Subsequent
 * calls return the same object — mutations on the result are observed by all
 * future readers.
 */
export function getConfig(): SupermemoryConfig {
  if (!cachedConfig) cachedConfig = loadConfig();
  return cachedConfig;
}

/**
 * Discards the cached config so the next `getConfig()` call re-runs `loadConfig()`.
 * Intended for tests; production code should never need to invalidate the cache.
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walks the supported config locations under `<homeDir>/.config/opencode/`
 * (`.jsonc` first, then `.json`) and returns the first parseable object.
 * On parse failure or missing files, returns `{}` — the schema then provides
 * defaults for every field. This silent-recovery contract is pinned by
 * `tests/unit/config.test.ts (malformed.jsonc)`.
 */
function readFileConfig(homeDir: string): Record<string, unknown> {
  const configDir = join(homeDir, ".config", "opencode");
  const candidates = [join(configDir, "supermemory-p.jsonc"), join(configDir, "supermemory-p.json")];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const parsed = parseJsonc<unknown>(readFileSync(path, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Invalid JSONC — fall through to next candidate or the defaults.
    }
  }
  return {};
}

/**
 * Loads, validates, and returns the resolved Supermemory configuration.
 *
 * Resolution order for `apiKey` (highest priority first):
 *   1. `SUPERMEMORY_API_KEY` env var.
 *   2. `apiKey` field in `~/.config/opencode/supermemory.{jsonc,json}`.
 *   3. `apiKey` from `~/.local/share/opencode-supermemory-p/credentials.json` (OAuth flow).
 *
 * `keywordPatterns` is the merge of `DEFAULT_KEYWORD_PATTERNS` (always first)
 * and any user-supplied patterns whose regex compiles. Invalid regex strings
 * are silently dropped. Duplicates between the two lists are NOT deduped —
 * this matches the historical behavior pinned by the trailing-commas fixture
 * test.
 *
 * No caching here — call `getConfig()` for the cached singleton.
 */
export function loadConfig(options: LoadConfigOptions = {}): SupermemoryConfig {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();

  const fileConfig = readFileConfig(homeDir);

  // Resolve apiKey priority: env > file > credentials.
  let apiKey: string | undefined;
  if (typeof env.SUPERMEMORY_API_KEY === "string" && env.SUPERMEMORY_API_KEY.length > 0) {
    apiKey = env.SUPERMEMORY_API_KEY;
  } else if (typeof fileConfig.apiKey === "string") {
    apiKey = fileConfig.apiKey;
  } else {
    apiKey = loadCredentials(options.homeDir)?.apiKey;
  }

  // Filter user-supplied keyword patterns down to the ones that compile,
  // then merge with the always-on defaults.
  const rawPatterns = Array.isArray(fileConfig.keywordPatterns)
    ? (fileConfig.keywordPatterns as unknown[]).filter((p): p is string => typeof p === "string")
    : [];
  const validUserPatterns = rawPatterns.filter(isValidRegex);
  const mergedPatterns = [...DEFAULT_KEYWORD_PATTERNS, ...validUserPatterns];

  const rawConfig: Record<string, unknown> = {
    ...fileConfig,
    apiKey,
    keywordPatterns: mergedPatterns,
  };

  // The schema's per-field `.catch(default)` calls absorb any remaining type
  // / range errors, so this `.parse` call cannot throw under normal use.
  return SupermemoryConfigSchema.parse(rawConfig);
}
