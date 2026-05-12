/**
 * Keyword detection for the `chat.message` hook.
 *
 * `detectMemoryKeyword(content, config)` returns true when the user message
 * (with code segments stripped) contains any of the patterns in
 * `config.keywordPatterns`. The list is expected to already include both the
 * built-in defaults (`DEFAULT_KEYWORD_PATTERNS`) and any user-supplied
 * patterns — `src/config/loader.ts` performs the merge and validation at
 * config-load time, so this module just consumes the result.
 *
 * `DEFAULT_KEYWORD_PATTERNS` is re-exported here for callers that want to
 * inspect or extend the baseline list without reaching into `src/config/*`.
 */

import { removeCodeBlocks } from "@/chat/nudge";

export { DEFAULT_KEYWORD_PATTERNS } from "@/config/defaults";

export interface KeywordConfig {
  keywordPatterns: readonly string[];
}

export function detectMemoryKeyword(content: string, config: KeywordConfig): boolean {
  if (config.keywordPatterns.length === 0) return false;
  const pattern = new RegExp(`\\b(${config.keywordPatterns.join("|")})\\b`, "i");
  return pattern.test(removeCodeBlocks(content));
}
