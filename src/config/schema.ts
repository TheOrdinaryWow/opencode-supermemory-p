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
  apiKey: z.string().startsWith("sm_").optional(),
  similarityThreshold: z.number().gt(0).lte(1).catch(DEFAULTS.similarityThreshold),
  maxMemories: z.number().positive().catch(DEFAULTS.maxMemories),
  maxProjectMemories: z.number().positive().catch(DEFAULTS.maxProjectMemories),
  maxProfileItems: z.number().positive().catch(DEFAULTS.maxProfileItems),
  injectProfile: z.boolean().catch(DEFAULTS.injectProfile),
  containerTagPrefix: z.string().catch(DEFAULTS.containerTagPrefix),
  projectTagStrategy: z.enum(["hashDirectory", "hashGitRepoName", "rawGitRepoName"]).catch(DEFAULTS.projectTagStrategy),
  userContainerTag: z.string().optional(),
  projectContainerTag: z.string().optional(),
  filterPrompt: z.string().catch(DEFAULTS.filterPrompt),
  keywordPatterns: z.array(z.string()).catch(DEFAULTS.keywordPatterns),
  compactionThreshold: z.number().gt(0).lte(1).catch(DEFAULTS.compactionThreshold),

  // Safe-on memory-feature knobs.
  incrementalCapture: z.boolean().catch(DEFAULTS.incrementalCapture),
  maxCaptureChars: z.number().positive().catch(DEFAULTS.maxCaptureChars),
  postCompactionReinject: z.boolean().catch(DEFAULTS.postCompactionReinject),
  sessionEndSave: z.boolean().catch(DEFAULTS.sessionEndSave),
  signalExtraction: z.boolean().catch(DEFAULTS.signalExtraction),
  signalKeywords: z.array(z.string()).catch([...DEFAULTS.signalKeywords]),
  signalTurnsBefore: z.number().int().nonnegative().catch(DEFAULTS.signalTurnsBefore),
  recallKeywordPatterns: z.array(z.string()).catch([...DEFAULTS.recallKeywordPatterns]),
  dedupEnabled: z.boolean().catch(DEFAULTS.dedupEnabled),
  dedupCacheSize: z.number().int().positive().catch(DEFAULTS.dedupCacheSize),
  entityContext: z.string().catch(DEFAULTS.entityContext),
  metadataStripping: z.boolean().catch(DEFAULTS.metadataStripping),
  relativeTimeDisplay: z.boolean().catch(DEFAULTS.relativeTimeDisplay),
  memoUsageFooter: z.boolean().catch(DEFAULTS.memoUsageFooter),
  profileCrossArrayDedup: z.boolean().catch(DEFAULTS.profileCrossArrayDedup),

  // Costly-off memory-feature knobs.
  everyMessageRecall: z.boolean().catch(DEFAULTS.everyMessageRecall),
  reinjectEveryN: z.number().int().nonnegative().catch(DEFAULTS.reinjectEveryN),
  autoCategoryTagging: z.boolean().catch(DEFAULTS.autoCategoryTagging),
});

export type SupermemoryConfig = z.infer<typeof SupermemoryConfigSchema>;
