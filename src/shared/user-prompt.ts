/**
 * Prompt boundary: the contract between OpenCode's mutable `parts` bus and
 * supermemory-p's domain logic. Every hook that needs to know "what did the
 * user actually say" consumes a `PromptBoundary` rather than parsing parts
 * directly.
 *
 * Design principle — `polluted-skip`:
 *   Either a message is clean and we treat it as user input verbatim, or it
 *   contains ANY plugin/orchestrator scaffolding marker and we skip it
 *   ENTIRELY from the capture stream. We do not try to surgically strip out
 *   parts of a message — that path leads to fragile regex chains chasing
 *   every new marker some upstream framework introduces.
 *
 * The boundary surface is two pieces of information:
 *   - `userText`: best-effort extraction of the user's typed input. For
 *     messages wrapped in `<user-request>` or `<user-task>` (slash-command
 *     expansion), we pull the inner body. Otherwise we return the raw
 *     concatenated text. Use this for SEARCH and KEYWORD DETECTION.
 *   - `isPolluted`: true when the raw text matches ANY pollution pattern.
 *     Use this to GATE CAPTURE. Polluted messages must never enter
 *     long-term memory.
 *
 * `POLLUTION_PATTERNS` is the single source of truth used by both the
 * runtime hooks and the standalone `scripts/purge-injected.ts` script.
 * Add new markers here.
 */

export type MessageRole = "user" | "assistant";

export interface TextPartLike {
  type: string;
  text?: unknown;
  synthetic?: boolean;
  ignored?: boolean;
}

export interface PromptBoundary {
  /** Concatenated text of eligible (non-synthetic, non-ignored) parts. */
  rawText: string;
  /**
   * Best-effort user-typed content extracted from `rawText`. For
   * slash-command expansions wrapped in `<user-request>` / `<user-task>`,
   * this is the inner body; otherwise it is `rawText` trimmed.
   *
   * Always safe to use as a search query — does NOT imply the message is
   * clean enough to capture. Check `isPolluted` for that.
   */
  userText: string;
  /** Alias of `userText`. */
  text: string;
  /**
   * True when the raw message contains plugin/orchestrator scaffolding
   * (OMO injections, Sisyphus orchestrator scaffolds, supermemory's own
   * injections, slash-command wrappers, system directives, etc.).
   *
   * Capture-path callers MUST skip polluted messages entirely. Query-path
   * callers can still use `userText` — it represents what the user
   * meaningfully typed, even when wrapped.
   */
  isPolluted: boolean;
  /** OpenCode session this boundary belongs to, if known. */
  sessionID?: string;
  /** Role of the message this boundary was extracted from, if known. */
  role?: MessageRole;
}

export interface PromptBoundaryContext {
  sessionID?: string;
  role?: MessageRole;
}

/**
 * Markers that flag a message as containing plugin/orchestrator scaffolding.
 * Matching ANY pattern flips `isPolluted` to true.
 *
 * Keep this list in sync with `scripts/purge-injected.ts` (the standalone
 * cleanup script uses its own copy so it can run without depending on the
 * full module graph).
 */
export const POLLUTION_PATTERNS: ReadonlyArray<RegExp> = [
  // Plugin block wrappers (OMO and similar). Match the opening tag only — a
  // bare `<system-reminder` is enough to flag the message; we don't need to
  // care whether the closer is balanced because we will drop the whole
  // message anyway.
  /<(?:auto-slash-command|command-instruction|session-context|system-reminder|supermemory-context|user-request|user-task)\b/i,
  // Sisyphus orchestrator scaffold wrapper.
  /<Work_Context\b/,
  // Skill tool output — SKILL.md bodies loaded into the conversation are not
  // user-typed content even though they ride in the user-message stream.
  /<skill_content\b/i,
  /<available_skills\b/i,
  // System directive line headers.
  /\[SYSTEM DIRECTIVE:/i,
  /\[restore checkpointed session/i,
  /<!--\s*OMO_INTERNAL_INITIATOR\s*-->/i,
  // Sisyphus task briefs (`## F1:` through `## F9:`).
  /^[\t ]*## F\d+:/m,
  // Sisyphus plan-management headers and announcements.
  /^[\t ]*## Auto-Selected Plan[\t ]*$/m,
  /^[\t ]*## Plan Not Found\b/m,
  /^[\t ]*boulder\.json has been created\./m,
  // Sisyphus mode indicators on their own line.
  /^[\t ]*\[(?:analyze|search|deep|ultrawork|ultrabrain|artistry|writing|quick|visual-engineering|unspecified-(?:low|high))-mode\][\t ]*$/m,
  // Standalone scaffolding signature strings.
  /You are starting a Sisyphus work session\./,
  /MANDATORY delegate_task params:/,
];

const USER_WRAPPER_PATTERN = /<(user-request|user-task)>([\s\S]*?)<\/\1>/gi;

/**
 * True iff `text` contains any pollution marker.
 *
 * Cheap (compiled regex tests, no allocations). Safe on empty / undefined.
 */
export function isPolluted(text: string | undefined | null): boolean {
  if (!text) return false;
  return POLLUTION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Pull the user's actual typed content out of a raw message body. If the
 * body is wrapped in `<user-request>` / `<user-task>` (OMO slash-command
 * expansion), we extract the inner body. Otherwise we return the trimmed
 * raw text — the caller can decide whether to use it based on
 * `isPolluted`.
 */
function extractUserContent(rawText: string): string {
  if (!rawText) return "";
  const wrapped: string[] = [];
  for (const match of rawText.matchAll(USER_WRAPPER_PATTERN)) {
    const body = match[2];
    if (typeof body === "string") {
      const trimmed = body.trim();
      if (trimmed.length > 0) wrapped.push(trimmed);
    }
  }
  if (wrapped.length > 0) return wrapped.join("\n").trim();
  return rawText.trim();
}

/**
 * Build a `PromptBoundary` from raw parts + optional caller context. Always
 * the preferred entry point for hooks. Returns a frozen object so callers
 * can pass it around without worrying about mutation.
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
 * message. Polluted text never makes it through — better to inject nothing
 * than to leak markers that re-trigger downstream plugins (this was the
 * root cause of the original Atlas-bug regression).
 *
 * Clean text passes through unchanged.
 */
export function sanitizeMemoryContextForInjection(memoryContext: string): string {
  if (!memoryContext) return "";
  return isPolluted(memoryContext) ? "" : memoryContext;
}
