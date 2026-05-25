/**
 * Prompt boundary: the contract between OpenCode's mutable `parts` bus and
 * supermemory-p's domain logic. Every hook that needs to know "what did the
 * user actually say" consumes a `PromptBoundary` rather than parsing parts
 * directly.
 *
 * Design — strip, don't skip:
 *   When a message contains plugin/orchestrator scaffolding, we strip the
 *   known marker shapes and keep whatever user content remains. Dropping
 *   the entire message is too aggressive — real conversations often mix
 *   scaffolding headers (e.g. `[analyze-mode]\n…\n---\n`) with actual user
 *   text on the same turn.
 *
 *   `isPolluted` is exposed as an observability flag (used in logs and the
 *   purge script) so downstream callers can SEE when a message was cleaned,
 *   even though we don't gate capture on it. Capture gates on whether
 *   anything remained after stripping (`userText.length > 0`).
 *
 * The boundary surface:
 *   - `userText`: best-effort user content. For slash-command expansions
 *     wrapped in `<user-request>` / `<user-task>` we extract the inner
 *     body verbatim. Otherwise we run `stripScaffolding` over the raw
 *     text and return the trimmed remainder.
 *   - `rawText`: concatenated text of eligible (non-synthetic,
 *     non-ignored) parts before any cleaning. Useful for debugging when
 *     extraction is unexpectedly empty.
 *   - `isPolluted`: true when ANY detection pattern matched the raw text.
 *
 * The pattern lists below are the single source of truth used by both the
 * runtime hooks and `scripts/purge-injected.ts` — keep the purge script's
 * copy in sync when adding markers here.
 */

export type MessageRole = "user" | "assistant";

export interface TextPartLike {
  type: string;
  text?: unknown;
  synthetic?: boolean;
  ignored?: boolean;
}

export interface PromptBoundary {
  rawText: string;
  userText: string;
  text: string;
  isPolluted: boolean;
  sessionID?: string;
  role?: MessageRole;
}

export interface PromptBoundaryContext {
  sessionID?: string;
  role?: MessageRole;
}

/**
 * Multi-shape strip patterns. Each entry deletes a specific scaffolding
 * shape from text. Applied in order; later entries clean up residue from
 * earlier ones.
 */
const SCAFFOLDING_PATTERNS: ReadonlyArray<RegExp> = [
  // Block-tag wrappers, content + tags.
  /<auto-slash-command>[\s\S]*?<\/auto-slash-command>/gi,
  /<command-instruction>[\s\S]*?<\/command-instruction>/gi,
  /<session-context>[\s\S]*?<\/session-context>/gi,
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
  /<supermemory-context>[\s\S]*?<\/supermemory-context>/gi,
  /<Work_Context>[\s\S]*?<\/Work_Context>/g,
  /<available_skills>[\s\S]*?<\/available_skills>/gi,
  /<skill_content[^>]*>[\s\S]*?<\/skill_content>/gi,

  // Sisyphus multi-line preambles (mode block through the trailing
  // delegate_task example, or the delegate_task reminder on its own).
  /\[(?:analyze|search|deep|ultrawork|ultrabrain|artistry|writing|quick|visual-engineering|unspecified-(?:low|high))-mode\][\s\S]*?Example: delegate_task\([^)]*\)\s*/g,
  /MANDATORY delegate_task params:[\s\S]*?Example: delegate_task\([^)]*\)\s*/g,

  // Sub-agent / consultant invocation prompts. These are never typed by a
  // human — they are role/task briefs injected by orchestrators (Sisyphus
  // Prometheus, F-task auditors, etc.). The whole brief is scaffolding,
  // so we strip from the first marker to the next isolated `---` line or
  // end-of-message. Two shapes we have seen in the wild:
  //   Prometheus:  `---\nYou are being invoked by <Name> - <Role>, ...`
  //   F-task:      `You are F<N> — <Title>. Read-only consultation. ...`
  // The opening `---` is optional; some callers omit it.
  /(?:^|\n)---[\t ]*\n(?:[\t ]*\n)*You are being invoked by [\s\S]*?\n---[\t ]*\n+/g,
  /(?:^|\n)You are being invoked by [\s\S]*$/,
  /(?:^|\n)You are F\d+\s+[—–-]\s[\s\S]*$/,

  // Auto-Selected Plan announcement through the boulder.json kickoff line.
  /## Auto-Selected Plan[\s\S]*?boulder\.json has been created\.[^\n]*\n?/g,

  // Plan Not Found prompt block.
  /## Plan Not Found[\s\S]*?Ask the user which plan to work on\.\s*/g,

  // Line-anchored fallbacks for orphan headers that escaped the multi-line
  // patterns above.
  /^[\t ]*## F\d+:.*$/gm,
  /^[\t ]*## Auto-Selected Plan[\t ]*$/gm,
  /^[\t ]*## Plan Not Found\b.*$/gm,
  /^[\t ]*boulder\.json has been created\..*$/gm,
  /^[\t ]*\[(?:analyze|search|deep|ultrawork|ultrabrain|artistry|writing|quick|visual-engineering|unspecified-(?:low|high))-mode\][\t ]*$/gm,
  /^[\t ]*\[SYSTEM DIRECTIVE:[^\]]*\].*$/gm,
  /^[\t ]*\[restore checkpointed session[^\]]*\].*$/gm,
  /^[\t ]*<!--\s*OMO_INTERNAL_INITIATOR\s*-->[\t ]*$/gm,

  // Orphan tag fragments (when block extraction missed a closer).
  /<\/?(?:auto-slash-command|command-instruction|session-context|system-reminder|supermemory-context|Work_Context)[^>]*>/gi,

  // Standalone signature phrases that hooks key off without surrounding tags.
  /You are starting a Sisyphus work session\./g,
];

/**
 * Cheap detection-only patterns. Used for the `isPolluted` flag — a fast
 * `regex.test()` rather than a full strip pass.
 *
 * Keep these as a SUPERSET of what `SCAFFOLDING_PATTERNS` removes. Anything
 * we strip should also be detected here, plus the user-wrapper tags (which
 * are NOT stripped — their content is the user's actual input).
 *
 * `scripts/purge-injected.ts` keeps its own copy of this list — keep them
 * in sync when adding markers.
 */
export const POLLUTION_PATTERNS: ReadonlyArray<RegExp> = [
  /<(?:auto-slash-command|command-instruction|session-context|system-reminder|supermemory-context|user-request|user-task)\b/i,
  /<Work_Context\b/,
  /<(?:available_skills|skill_content)\b/i,
  /\[SYSTEM DIRECTIVE:/i,
  /\[restore checkpointed session/i,
  /<!--\s*OMO_INTERNAL_INITIATOR\s*-->/i,
  /^[\t ]*## F\d+:/m,
  /^[\t ]*## Auto-Selected Plan[\t ]*$/m,
  /^[\t ]*## Plan Not Found\b/m,
  /^[\t ]*boulder\.json has been created\./m,
  /^[\t ]*\[(?:analyze|search|deep|ultrawork|ultrabrain|artistry|writing|quick|visual-engineering|unspecified-(?:low|high))-mode\][\t ]*$/m,
  /You are starting a Sisyphus work session\./,
  /MANDATORY delegate_task params:/,

  // Sub-agent invocation prompts (see SCAFFOLDING_PATTERNS for shapes).
  /(?:^|\n)You are being invoked by /,
  /(?:^|\n)You are F\d+\s+[—–-]\s/,
];

const USER_WRAPPER_PATTERN = /<(user-request|user-task)>([\s\S]*?)<\/\1>/gi;

/**
 * True iff the text contains any known scaffolding marker. Observability
 * only — capture-path callers do NOT gate on this. Use `userText` for
 * gating instead (empty after strip → skip).
 */
export function isPolluted(text: string | undefined | null): boolean {
  if (!text) return false;
  return POLLUTION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Strip every known scaffolding shape from `text` and tidy up the
 * remaining whitespace. The returned string is what the user actually
 * typed (best-effort).
 */
export function stripScaffolding(text: string): string {
  if (!text) return "";
  let result = text;
  for (const pattern of SCAFFOLDING_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function extractWrappedUserContent(rawText: string): string {
  if (!rawText) return "";
  const wrapped: string[] = [];
  for (const match of rawText.matchAll(USER_WRAPPER_PATTERN)) {
    const body = match[2];
    if (typeof body === "string") {
      const trimmed = body.trim();
      if (trimmed.length > 0) wrapped.push(trimmed);
    }
  }
  return wrapped.join("\n").trim();
}

function extractUserContent(rawText: string): string {
  if (!rawText) return "";
  const wrapped = extractWrappedUserContent(rawText);
  if (wrapped.length > 0) return wrapped;
  return stripScaffolding(rawText);
}

/**
 * Build a `PromptBoundary` from raw parts + optional caller context. The
 * preferred entry point for hooks.
 */
export function createPromptBoundary(parts: readonly TextPartLike[] | undefined, context: PromptBoundaryContext = {}): PromptBoundary {
  const eligible = (parts ?? []).filter(
    (p): p is TextPartLike & { text: string } => p.type === "text" && typeof p.text === "string" && !p.synthetic && !p.ignored,
  );
  const rawText = eligible.map((p) => p.text).join("\n");
  const userText = extractUserContent(rawText);
  return Object.freeze({
    rawText,
    text: userText,
    userText,
    isPolluted: isPolluted(rawText),
    sessionID: context.sessionID,
    role: context.role,
  });
}

/**
 * Sanitize a memory-context string before injecting it back into a chat
 * message. Strips known scaffolding shapes — keeps any clean content so
 * useful context survives even when individual memories were captured
 * with markers in them.
 */
export function sanitizeMemoryContextForInjection(memoryContext: string): string {
  return stripScaffolding(memoryContext);
}
