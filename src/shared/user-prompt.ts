/**
 * User prompt boundary: a single source of truth for "what did the user
 * actually type" in a chat message.
 *
 * OpenCode's `output.parts` is a shared, mutable prompt bus: it carries the
 * user's input, slash-command expansions, system reminders, recovery prompts,
 * memory injections, and more. Many of those entries are produced by other
 * plugins (notably oh-my-openagent / OMO) and intentionally LOOK like user
 * input because they overwrite the user's part text directly. They are not
 * marked `synthetic: true`.
 *
 * If supermemory treats every text part as user input, three things break:
 *   1. Searches/profile queries get polluted by plugin templates.
 *   2. Long-term memory ingests OMO marker strings (e.g. the start-work
 *      template) — turning every future session into a context-injection
 *      trojan that re-triggers OMO's start-work-hook into forcing the
 *      `atlas` agent.
 *   3. Keyword detection fires on plugin reminders, not user intent.
 *
 * This module is the boundary. Every place that consumes "user text" from
 * `parts` MUST route through `extractUserPromptFromParts` (or the lower-level
 * `extractUserPrompt`). Every place that injects supermemory's own context
 * back into a chat message MUST sanitize it through
 * `sanitizeMemoryContextForInjection` first.
 *
 * Strategy (per Oracle review):
 *   1. Honor OpenCode part flags: skip `synthetic === true` and
 *      `ignored === true` parts.
 *   2. Code fences (triple-backtick blocks) are sacrosanct — we never alter
 *      content inside them. This lets users paste source code (including
 *      OMO templates we are debugging right now) without lossy filtering.
 *   3. In prose, prefer explicit user-content wrappers: `<user-request>` and
 *      `<user-task>` are how OMO wraps the actual user arguments inside a
 *      slash-command expansion. If present, extract them.
 *   4. Fall back to a denylist removal of known plugin-injected block tags
 *      (`<auto-slash-command>`, `<command-instruction>`, `<session-context>`,
 *      `<system-reminder>`, `<supermemory-context>`) plus line-prefix
 *      directives (`[SYSTEM DIRECTIVE: ...]`, the OMO checkpoint restore
 *      prompt, the OMO_INTERNAL_INITIATOR marker).
 *   5. Conservative on malformed input — leave user content intact rather
 *      than risk catastrophic deletion. Orphan opening/closing tags are not
 *      stripped from `extractUserPrompt`; we trust that the user's text is
 *      more important than perfect cleanup.
 *
 * `sanitizeMemoryContextForInjection` is more aggressive: when we are about
 * to inject memory text BACK into a chat message, we cannot afford any
 * leftover wrapper or trigger phrase, because OMO and friends will read the
 * combined parts and react to anything that looks like their own marker.
 * Memory is structured data we produce — there is no user-typed code fence
 * to preserve, so we strip everything known to be dangerous, including bare
 * trigger phrases like the start-work-hook canary string.
 */

const USER_WRAPPER_PATTERN = /<(user-request|user-task)>([\s\S]*?)<\/\1>/gi;

// Block-level wrappers OMO and friends inject around their own content. The
// supermemory-context entry exists so future supermemory injections can be
// stripped cleanly if they re-enter the parts stream (e.g. via conversation
// history fed back through SDK calls).
const BLOCK_TAGS_TO_STRIP = [
  "auto-slash-command",
  "command-instruction",
  "session-context",
  "system-reminder",
  "supermemory-context",
] as const;

// Tags that may appear in memory text as an orphan opener/closer after
// chunking. Includes the user wrappers — memory has no business carrying an
// active <user-request> tag; if it does, the memory was captured from a
// previously polluted session.
const ORPHAN_TAG_PATTERN =
  /<\/?(?:auto-slash-command|command-instruction|session-context|system-reminder|supermemory-context|user-request|user-task)[^>]*>/gi;

const LINE_PREFIXES_TO_STRIP: RegExp[] = [
  /^[\t ]*\[SYSTEM DIRECTIVE:[^\]]*\].*$/gm,
  /^[\t ]*\[restore checkpointed session agent configuration after compaction\][\t ]*$/gm,
  /^[\t ]*<!--\s*OMO_INTERNAL_INITIATOR\s*-->[\t ]*$/gm,
];

// Standalone trigger phrases that OMO hooks key off without any surrounding
// tag. Currently the start-work-hook checks for this canary string.
const STANDALONE_TRIGGER_PHRASES: RegExp[] = [/You are starting a Sisyphus work session\./g];

const CODE_FENCE_PATTERN = /```[\s\S]*?```/g;

export type SourceKind = "wrapped-user-content" | "sanitized-text" | "raw-text" | "empty";

export type MessageRole = "user" | "assistant";

export interface TextPartLike {
  type: string;
  text?: unknown;
  synthetic?: boolean;
  ignored?: boolean;
}

/**
 * Result of extracting the user-typed portion of one or more text parts.
 * Kept as a structured value (vs. a bare string) so downstream callers can
 * carry provenance information (source, stripped markers) into logs, memory
 * records, and tests without re-running the extractor.
 */
export interface ExtractedUserPrompt {
  /** The extracted user text, or "" if nothing remained after sanitization. */
  text: string;
  /** How the text was obtained — useful for logging and tests. */
  source: SourceKind;
  /** Names of markers that were detected/removed; informational only. */
  strippedMarkers: string[];
}

/**
 * The contract between OpenCode's mutable `parts` bus and supermemory-p's
 * domain logic. Every hook that needs to know "what did the user actually
 * say" should consume a `PromptBoundary` rather than parsing parts directly.
 *
 * - `rawText` preserves the concatenated text of all eligible (non-synthetic,
 *   non-ignored) parts before any extraction. Useful for debugging when
 *   extraction is unexpectedly empty.
 * - `userText` is the post-extraction value, alias of `text` for clarity at
 *   call sites.
 * - `sessionID` / `role` are optional metadata the caller can attach so logs
 *   and memory provenance carry through without re-deriving them.
 */
export interface PromptBoundary extends ExtractedUserPrompt {
  /** Concatenated text of eligible parts before extraction. */
  rawText: string;
  /** Alias of `text`. */
  userText: string;
  /** OpenCode session this boundary belongs to, if known. */
  sessionID?: string;
  /** Role of the message this boundary was extracted from, if known. */
  role?: MessageRole;
}

export interface PromptBoundaryContext {
  sessionID?: string;
  role?: MessageRole;
}

interface Segment {
  type: "code" | "prose";
  content: string;
}

function splitFencedCode(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CODE_FENCE_PATTERN)) {
    const idx = match.index ?? 0;
    if (idx > cursor) {
      segments.push({ type: "prose", content: text.slice(cursor, idx) });
    }
    segments.push({ type: "code", content: match[0] });
    cursor = idx + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ type: "prose", content: text.slice(cursor) });
  }
  return segments;
}

function extractWrappedUserContent(prose: string): string[] {
  const contents: string[] = [];
  for (const match of prose.matchAll(USER_WRAPPER_PATTERN)) {
    const body = match[2];
    if (typeof body === "string") {
      contents.push(body.trim());
    }
  }
  return contents;
}

function stripBlockTagsFromProse(prose: string): string {
  let result = prose;
  for (const tag of BLOCK_TAGS_TO_STRIP) {
    result = result.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "gi"), "");
  }
  for (const pattern of LINE_PREFIXES_TO_STRIP) {
    result = result.replace(pattern, "");
  }
  return result;
}

function collectStrippedMarkers(raw: string): string[] {
  const markers: string[] = [];
  if (/<auto-slash-command>/i.test(raw)) markers.push("auto-slash-command");
  if (/<command-instruction>/i.test(raw)) markers.push("command-instruction");
  if (/<session-context>/i.test(raw)) markers.push("session-context");
  if (/<system-reminder>/i.test(raw)) markers.push("system-reminder");
  if (/<supermemory-context>/i.test(raw)) markers.push("supermemory-context");
  if (/\[SYSTEM DIRECTIVE:/i.test(raw)) markers.push("system-directive");
  if (/\[restore checkpointed session/i.test(raw)) markers.push("checkpoint-restore");
  if (/<!--\s*OMO_INTERNAL_INITIATOR\s*-->/i.test(raw)) markers.push("omo-internal-initiator");
  return markers;
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

/**
 * Extract the user-typed portion of a raw chat text. See module header for
 * the full strategy. Safe for empty/whitespace input.
 */
export function extractUserPrompt(rawText: string): ExtractedUserPrompt {
  if (!rawText || rawText.trim().length === 0) {
    return { text: "", source: "empty", strippedMarkers: [] };
  }

  const segments = splitFencedCode(rawText);
  const proseSegments = segments.filter((s) => s.type === "prose");

  // Step 1: explicit user wrappers win when both present and non-empty.
  const wrapped = proseSegments.flatMap((s) => extractWrappedUserContent(s.content));
  const wrappedNonEmpty = wrapped.filter((c) => c.length > 0);

  if (wrappedNonEmpty.length > 0) {
    return {
      text: wrappedNonEmpty.join("\n").trim(),
      source: "wrapped-user-content",
      strippedMarkers: ["user-wrapper"],
    };
  }

  if (wrapped.length > 0) {
    // Wrapper present but empty — caller said "no user content"; respect it.
    return { text: "", source: "empty", strippedMarkers: ["user-wrapper-empty"] };
  }

  // Step 2: denylist-strip prose; code fences pass through untouched.
  const sanitizedSegments = segments.map((segment) =>
    segment.type === "code" ? segment.content : stripBlockTagsFromProse(segment.content),
  );
  const sanitized = collapseBlankLines(sanitizedSegments.join("")).trim();

  if (sanitized.length === 0) {
    return { text: "", source: "empty", strippedMarkers: collectStrippedMarkers(rawText) };
  }

  const changed = sanitized !== rawText.trim();
  return {
    text: sanitized,
    source: changed ? "sanitized-text" : "raw-text",
    strippedMarkers: changed ? collectStrippedMarkers(rawText) : [],
  };
}

/**
 * Convenience wrapper: filter out synthetic/ignored/non-text parts, join the
 * eligible texts, then run `extractUserPrompt` over the combined string.
 *
 * Pass `parts === undefined` and you get an empty result back — safe for
 * cases where the hook payload may omit the parts list.
 */
export function extractUserPromptFromParts(parts: readonly TextPartLike[] | undefined): ExtractedUserPrompt {
  if (!parts || parts.length === 0) {
    return { text: "", source: "empty", strippedMarkers: [] };
  }

  const eligible = parts.filter(
    (p): p is TextPartLike & { text: string } => p.type === "text" && typeof p.text === "string" && !p.synthetic && !p.ignored,
  );

  if (eligible.length === 0) {
    return { text: "", source: "empty", strippedMarkers: [] };
  }

  const joined = eligible.map((p) => p.text).join("\n");
  return extractUserPrompt(joined);
}

/**
 * Build a `PromptBoundary` from raw parts + optional metadata. This is the
 * preferred entry point for hooks — the returned object carries the raw
 * text, the extracted user text, provenance information, and any caller
 * context (sessionID, role) all in one immutable bundle.
 *
 * For places that only need `string`, the lower-level `extractUserPrompt*`
 * functions remain available.
 */
export function createPromptBoundary(parts: readonly TextPartLike[] | undefined, context: PromptBoundaryContext = {}): PromptBoundary {
  const eligible = (parts ?? []).filter(
    (p): p is TextPartLike & { text: string } => p.type === "text" && typeof p.text === "string" && !p.synthetic && !p.ignored,
  );
  const rawText = eligible.map((p) => p.text).join("\n");
  const extracted = extractUserPrompt(rawText);

  return Object.freeze({
    rawText,
    text: extracted.text,
    userText: extracted.text,
    source: extracted.source,
    strippedMarkers: extracted.strippedMarkers,
    sessionID: context.sessionID,
    role: context.role,
  });
}

/**
 * Sanitize memory context BEFORE injecting it back into a user message's
 * parts. More aggressive than `extractUserPrompt` because:
 *   - We control the input (formatted memory, not user text), so there is no
 *     code fence to preserve.
 *   - Any leftover OMO trigger phrase or wrapper here will be processed by
 *     downstream plugins as if the user typed it.
 *
 * Strips block tags, orphan tag fragments, line-prefix directives, and
 * standalone trigger phrases (the start-work-hook canary string).
 */
export function sanitizeMemoryContextForInjection(memoryContext: string): string {
  if (!memoryContext) return "";

  let cleaned = memoryContext;

  // Strip complete block tags (including user-wrappers — memory should never
  // carry an active <user-request> tag).
  for (const tag of [...BLOCK_TAGS_TO_STRIP, "user-request", "user-task"]) {
    cleaned = cleaned.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "gi"), "");
  }

  // Strip orphan opener/closer fragments left behind by chunked memories.
  cleaned = cleaned.replace(ORPHAN_TAG_PATTERN, "");

  // Strip line-prefix directives.
  for (const pattern of LINE_PREFIXES_TO_STRIP) {
    cleaned = cleaned.replace(pattern, "");
  }

  // Neutralize standalone trigger phrases.
  for (const pattern of STANDALONE_TRIGGER_PHRASES) {
    cleaned = cleaned.replace(pattern, "");
  }

  return collapseBlankLines(cleaned).trim();
}
