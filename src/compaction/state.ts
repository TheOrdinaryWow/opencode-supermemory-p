/**
 * Per-session bookkeeping for the compaction hook. The shape is preserved
 * from the original inline definition in src/services/compaction.ts so the
 * extraction is behaviour-neutral.
 */
export interface CompactionState {
  /** Wall-clock time (ms since epoch) of the last successful compaction trigger, per session. Used for cooldown gating. */
  lastCompactionTime: Map<string, number>;
  /** Sessions currently mid-compaction — re-entrancy guard. */
  compactionInProgress: Set<string>;
  /** Sessions whose summary message still needs to be captured into long-term memory. */
  summarizedSessions: Set<string>;
}

/**
 * Factory for a fresh CompactionState. Use this instead of inlining the
 * `{ new Map(), new Set(), ... }` object so every hook instance has the same
 * shape and adding new tracking fields stays a one-line change.
 */
export function createCompactionState(): CompactionState {
  return {
    lastCompactionTime: new Map(),
    compactionInProgress: new Set(),
    summarizedSessions: new Set(),
  };
}
