/**
 * Static defaults for the Supermemory plugin configuration.
 *
 * Two exports:
 * - `DEFAULT_KEYWORD_PATTERNS`: 16 baseline regex strings that always seed the
 *   merged `keywordPatterns` list. User-supplied patterns are appended (and
 *   filtered for valid regex syntax) by the loader.
 * - `DEFAULTS`: per-field fallback values used when the file config omits a key
 *   or the value fails schema validation. Mirrors the shape of
 *   `SupermemoryConfig` minus `apiKey` / `userContainerTag` /
 *   `projectContainerTag` (those are intentionally optional and have no
 *   default).
 */

export const DEFAULT_KEYWORD_PATTERNS: readonly string[] = [
  "remember",
  "memorize",
  "save\\s+this",
  "note\\s+this",
  "keep\\s+in\\s+mind",
  "don'?t\\s+forget",
  "learn\\s+this",
  "store\\s+this",
  "record\\s+this",
  "make\\s+a\\s+note",
  "take\\s+note",
  "jot\\s+down",
  "commit\\s+to\\s+memory",
  "remember\\s+that",
  "never\\s+forget",
  "always\\s+remember",
];

export const DEFAULTS = {
  similarityThreshold: 0.6,
  maxMemories: 5,
  maxProjectMemories: 10,
  maxProfileItems: 5,
  injectProfile: true,
  containerTagPrefix: "opencode",
  projectTagStrategy: "hashGitRepoName",
  filterPrompt:
    "You are a stateful coding agent. Remember all the information, including but not limited to user's coding preferences, tech stack, behaviours, workflows, and any other relevant details.",
  keywordPatterns: [] as string[],
  compactionThreshold: 0.8,
} as const;
