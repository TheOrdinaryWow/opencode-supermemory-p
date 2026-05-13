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
 */
export const SupermemoryConfigSchema = z.object({
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
});

export type SupermemoryConfig = z.infer<typeof SupermemoryConfigSchema>;
