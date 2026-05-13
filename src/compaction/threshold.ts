/**
 * Compaction threshold constants and the pure decision function. The shipped
 * hook in src/services/compaction.ts still inlines the gate today; a future
 * collapse that onto computeShouldCompact(). Until then, this module is the
 * single source of truth for the constants so tests, future call sites and
 * config audits all agree on one value.
 */

/** Default usage ratio at which compaction triggers when the user does not override it. */
export const DEFAULT_THRESHOLD = 0.8;

/** Lower bound on totalUsed tokens before the threshold gate is considered at all. Avoids thrashing on tiny sessions. */
export const MIN_TOKENS_FOR_COMPACTION = 50_000;

/** Minimum gap between two compactions for the same session, in milliseconds. */
export const COMPACTION_COOLDOWN_MS = 30_000;

/** Fallback context window when getModelLimit() returns undefined (i.e. unknown provider/model). */
export const DEFAULT_CONTEXT_LIMIT = 200_000;

export interface TokenInfo {
  input: number;
  output: number;
  cache: { read: number; write: number };
}

export interface ShouldCompactInput {
  tokens: TokenInfo;
  threshold: number;
  contextLimit: number;
  /** Last compaction time for this session, or 0 if never compacted. */
  lastCompactionAt: number;
  /** Whether the triggering message is itself a summary message. */
  isSummary: boolean;
  /** Whether a compaction is already running for this session. */
  inProgress: boolean;
  /** Current wall-clock time in ms since epoch. Injected so the function stays pure. */
  now: number;
}

export type SkipReason = "in-progress" | "cooldown" | "is-summary" | "below-min-tokens" | "below-threshold";

export interface ShouldCompactResult {
  shouldCompact: boolean;
  reason?: SkipReason;
  /** input + cache.read + output. Always populated, even when shouldCompact is false. */
  totalUsed: number;
  /** totalUsed / contextLimit. Always populated, even when shouldCompact is false. */
  usageRatio: number;
}

/**
 * Pure decision: should we trigger compaction for this session right now?
 * Mirrors the gate ordering in createCompactionHook → checkAndTriggerCompaction
 * (in-progress / cooldown / summary / min-tokens / threshold) so behaviour stays
 * identical once fully wired in. totalUsed and usageRatio are always
 * computed so the caller can log them regardless of the decision.
 */
export function computeShouldCompact(input: ShouldCompactInput): ShouldCompactResult {
  const totalUsed = input.tokens.input + input.tokens.cache.read + input.tokens.output;
  const usageRatio = totalUsed / input.contextLimit;

  if (input.inProgress) return { shouldCompact: false, reason: "in-progress", totalUsed, usageRatio };
  if (input.now - input.lastCompactionAt < COMPACTION_COOLDOWN_MS) {
    return { shouldCompact: false, reason: "cooldown", totalUsed, usageRatio };
  }
  if (input.isSummary) return { shouldCompact: false, reason: "is-summary", totalUsed, usageRatio };
  if (totalUsed < MIN_TOKENS_FOR_COMPACTION) {
    return { shouldCompact: false, reason: "below-min-tokens", totalUsed, usageRatio };
  }
  if (usageRatio < input.threshold) {
    return { shouldCompact: false, reason: "below-threshold", totalUsed, usageRatio };
  }

  return { shouldCompact: true, totalUsed, usageRatio };
}
