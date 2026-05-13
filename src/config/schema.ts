import { z } from "zod";

import { DEFAULTS } from "@/config/defaults";

/**
 * Zod schema for the resolved Supermemory plugin configuration.
 *
 * Validation philosophy — silent recovery:
 * Each field that has a documented default uses `.catch(default)` so a
 * malformed user value (wrong type, out-of-range number, etc.) is silently
 * coerced to the default rather than aborting the entire load. The historical
 * behavior of the plugin is "never crash on bad config", and the schema
 * preserves that contract.
 *
 * `compactionThreshold` keeps the original `(0, 1]` range gate from
 * `validateCompactionThreshold` (lower bound exclusive, upper bound inclusive).
 *
 * `apiKey`, `userContainerTag`, `projectContainerTag` stay `.optional()` —
 * they have no semantic default and the loader / consumers branch on
 * `undefined` explicitly.
 *
 * Sections below mirror the layering in `src/config/defaults.ts`:
 *   1. Core knobs that predate the memory-feature work.
 *   2. Safe-on memory-feature knobs (default enabled / non-zero).
 *   3. Costly-off memory-feature knobs (default disabled / zero).
 */
export const SupermemoryConfigSchema = z.object({
  // Core knobs.
  apiKey: z.string().startsWith("sm_").optional().describe("Supermemory API key (can also use SUPERMEMORY_API_KEY env var)"),
  similarityThreshold: z
    .number()
    .gt(0)
    .lte(1)
    .catch(DEFAULTS.similarityThreshold)
    .describe("Min similarity score for memory retrieval (0-1)"),
  maxMemories: z.number().positive().catch(DEFAULTS.maxMemories).describe("Max relevant memories injected per request"),
  maxProjectMemories: z.number().positive().catch(DEFAULTS.maxProjectMemories).describe("Max project memories listed in context"),
  maxProfileItems: z.number().positive().catch(DEFAULTS.maxProfileItems).describe("Max profile facts injected in context"),
  injectProfile: z.boolean().catch(DEFAULTS.injectProfile).describe("Include user profile in injected context"),
  containerTagPrefix: z
    .string()
    .catch(DEFAULTS.containerTagPrefix)
    .describe("Prefix for auto-generated container tags (used when userContainerTag/projectContainerTag are not set)"),
  projectTagStrategy: z
    .enum(["hashDirectory", "hashGitRepoName", "rawGitRepoName"])
    .catch(DEFAULTS.projectTagStrategy)
    .describe("Strategy for generating the project container tag when projectContainerTag is not set"),
  userContainerTag: z.string().optional().describe("Optional explicit user container tag (overrides auto-generated tag)"),
  projectContainerTag: z.string().optional().describe("Optional explicit project container tag (overrides auto-generated tag)"),
  filterPrompt: z.string().catch(DEFAULTS.filterPrompt).describe("System prompt used as the memory-ingestion filter directive"),
  keywordPatterns: z
    .array(z.string())
    .catch(DEFAULTS.keywordPatterns)
    .describe("Extra regex patterns for memory-trigger keyword detection"),
  compactionThreshold: z
    .number()
    .gt(0)
    .lte(1)
    .catch(DEFAULTS.compactionThreshold)
    .describe("Context usage ratio that triggers preemptive compaction (0-1)"),

  // Safe-on memory-feature knobs.
  incrementalCapture: z.boolean().catch(DEFAULTS.incrementalCapture).describe("Save assistant turns progressively as they finish"),
  maxCaptureChars: z.number().positive().catch(DEFAULTS.maxCaptureChars).describe("Maximum characters kept from any captured turn"),
  postCompactionReinject: z.boolean().catch(DEFAULTS.postCompactionReinject).describe("Re-inject memory after context compaction"),
  sessionEndSave: z.boolean().catch(DEFAULTS.sessionEndSave).describe("Save a final memory snapshot when the session ends or idles"),
  signalExtraction: z.boolean().catch(DEFAULTS.signalExtraction).describe("Keep only turns that match signal keywords"),
  signalKeywords: z
    .array(z.string())
    .catch([...DEFAULTS.signalKeywords])
    .describe("Keywords that mark a turn as high-signal and trigger capture"),
  signalTurnsBefore: z
    .number()
    .int()
    .nonnegative()
    .catch(DEFAULTS.signalTurnsBefore)
    .describe("Number of earlier turns to include before a signal turn"),
  recallKeywordPatterns: z
    .array(z.string())
    .catch([...DEFAULTS.recallKeywordPatterns])
    .describe("Extra phrases that trigger an explicit recall search"),
  dedupEnabled: z.boolean().catch(DEFAULTS.dedupEnabled).describe("Skip duplicate memory saves by normalized content hash"),
  dedupCacheSize: z.number().int().positive().catch(DEFAULTS.dedupCacheSize).describe("Maximum number of entries kept in the dedup cache"),
  entityContext: z.string().catch(DEFAULTS.entityContext).describe("Short guidance passed to the entity-extraction pipeline"),
  metadataStripping: z.boolean().catch(DEFAULTS.metadataStripping).describe("Strip injected metadata from memory search queries"),
  relativeTimeDisplay: z
    .boolean()
    .catch(DEFAULTS.relativeTimeDisplay)
    .describe("Render memory timestamps as relative text (e.g. '2 hrs ago')"),
  memoUsageFooter: z.boolean().catch(DEFAULTS.memoUsageFooter).describe("Append a compact memory-count footer to injected context"),
  profileCrossArrayDedup: z
    .boolean()
    .catch(DEFAULTS.profileCrossArrayDedup)
    .describe("Deduplicate profile facts across profile, project, and relevant-memory arrays"),

  // Costly-off memory-feature knobs.
  everyMessageRecall: z
    .boolean()
    .catch(DEFAULTS.everyMessageRecall)
    .describe("Run recall search on every user message (costly; default off)"),
  reinjectEveryN: z
    .number()
    .int()
    .nonnegative()
    .catch(DEFAULTS.reinjectEveryN)
    .describe("Re-inject memory every N completed turns (0 disables it)"),
  autoCategoryTagging: z.boolean().catch(DEFAULTS.autoCategoryTagging).describe("Classify memories into categories before storing them"),
});

export type SupermemoryConfig = z.infer<typeof SupermemoryConfigSchema>;
