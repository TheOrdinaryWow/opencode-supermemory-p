/**
 * Static defaults for the Supermemory plugin configuration.
 *
 * Two layers:
 * - Module-level constants (`DEFAULT_KEYWORD_PATTERNS`, `DEFAULT_SIGNAL_KEYWORDS`,
 *   `DEFAULT_RECALL_KEYWORD_PATTERNS`, `DEFAULT_ENTITY_CONTEXT`) — the canonical
 *   data tables consumed both by the loader (merge logic) and by the schema
 *   (`.catch(...)` fallbacks).
 * - `DEFAULTS`: per-field fallback values used when the file config omits a key
 *   or the value fails schema validation. Mirrors the shape of
 *   `SupermemoryConfig` minus `apiKey` / `userContainerTag` /
 *   `projectContainerTag` (those are intentionally optional and have no
 *   default).
 *
 * Policy (decisions.md): "safe-on, costly-off" — every new memory-feature
 * key defaults to a non-trivial enabled value except the three flagged as
 * costly (`everyMessageRecall`, `reinjectEveryN`, `autoCategoryTagging`).
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

/**
 * Trigger phrases for the heuristic signal-extraction pass. Each entry is a
 * lowercase substring matched against incoming chat messages — no regex
 * compilation. Sourced from the claude-supermemory baseline plus a small set
 * of identity-anchoring phrases ("my name", "I work", "my company") that
 * surface lasting personal facts.
 */
export const DEFAULT_SIGNAL_KEYWORDS: readonly string[] = [
  "remember",
  "important",
  "save this",
  "note this",
  "don't forget",
  "key decision",
  "project info",
  "my name",
  "I work",
  "I prefer",
  "I use",
  "I like",
  "always",
  "never",
  "my team",
  "my email",
  "my company",
];

/**
 * Phrases that, when present in a user message, indicate an explicit recall
 * intent — the assistant should pull prior memories into scope before
 * answering. Lowercase substrings; no regex.
 */
export const DEFAULT_RECALL_KEYWORD_PATTERNS: readonly string[] = [
  "what did we",
  "remind me",
  "earlier you said",
  "what was the",
  "do you remember",
];

/**
 * Verbatim system-prompt fragment from openclaw-supermemory (memory.ts —
 * `DEFAULT_ENTITY_CONTEXT`). Length is well under the 1500-character clamp
 * documented there (`MAX_ENTITY_CONTEXT_LENGTH`). Used as the context window
 * passed to the entity-extraction pipeline.
 */
export const DEFAULT_ENTITY_CONTEXT: string = `User-assistant conversation. Format: [role: user]...[user:end] and [role: assistant]...[assistant:end].

Only extract things useful in FUTURE conversations. Most messages are not worth remembering.

REMEMBER: lasting personal facts — dietary restrictions, preferences, personal details, workplace, location, tools, ongoing projects, routines, explicit "remember this" requests.

DO NOT REMEMBER: temporary intents, one-time tasks, assistant actions (searching, writing files, generating code), assistant suggestions, implementation details, in-progress task status.

RULES:
- Assistant output is CONTEXT ONLY — never attribute assistant actions to the user
- "find X" or "do Y" = one-time request, NOT a memory
- Only store preferences explicitly stated ("I like...", "I prefer...", "I always...")
- When in doubt, do NOT create a memory. Less is more.`;

export const DEFAULTS = {
  // Existing keys (DO NOT change values — regression-guarded by tests/unit/config.test.ts).
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

  // Safe-on memory features (default enabled / non-zero).
  incrementalCapture: true,
  maxCaptureChars: 5000,
  postCompactionReinject: true,
  sessionEndSave: true,
  signalExtraction: true,
  signalKeywords: DEFAULT_SIGNAL_KEYWORDS,
  signalTurnsBefore: 3,
  recallKeywordPatterns: DEFAULT_RECALL_KEYWORD_PATTERNS,
  dedupEnabled: true,
  dedupCacheSize: 500,
  entityContext: DEFAULT_ENTITY_CONTEXT,
  metadataStripping: true,
  relativeTimeDisplay: true,
  memoUsageFooter: true,
  profileCrossArrayDedup: true,

  // Costly-off memory features (default disabled / zero).
  everyMessageRecall: false,
  reinjectEveryN: 0,
  autoCategoryTagging: false,
} as const;
