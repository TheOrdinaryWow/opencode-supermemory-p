/**
 * Backwards-compatibility shim for the original `src/config.ts` module.
 *
 * The real implementation now lives under `src/config/` (defaults, schema,
 * loader). This file:
 *   1. Re-exports the new lazy API (`loadConfig`, `getConfig`,
 *      `resetConfigCache`, `SupermemoryConfigSchema`, types, defaults).
 *   2. Provides eager `SUPERMEMORY_API_KEY` / `CONFIG` constants and the
 *      `isConfigured()` predicate so existing import sites
 *      (`src/index.ts`, `src/services/client.ts`, `src/services/context.ts`,
 *      `src/services/tags.ts`, `src/services/compaction.ts`) keep working
 *      without modification.
 *
 * Migration plan: once every consumer is moved to call `getConfig()` lazily,
 * this file (and the eager constants below) can be deleted.
 */

import { getConfig } from "./config/loader.js";

export { DEFAULT_KEYWORD_PATTERNS, DEFAULTS } from "./config/defaults.js";
export {
  getConfig,
  type LoadConfigOptions,
  loadConfig,
  resetConfigCache,
} from "./config/loader.js";
export {
  type SupermemoryConfig,
  SupermemoryConfigSchema,
} from "./config/schema.js";

const initialConfig = getConfig();

/**
 * Resolved API key from env / config file / OAuth credentials, captured at
 * module load time. New code should prefer `getConfig().apiKey`.
 */
export const SUPERMEMORY_API_KEY: string | undefined = initialConfig.apiKey;

/**
 * Resolved config snapshot, captured at module load time. New code should
 * prefer `getConfig()` so that test resets via `resetConfigCache()` propagate.
 */
export const CONFIG = initialConfig;

export function isConfigured(): boolean {
  return !!SUPERMEMORY_API_KEY;
}
