import { removeCodeBlocks } from "@/chat/nudge";
import { createPromptBoundary } from "@/shared/user-prompt";

const MAX_SIGNAL_TURN_CHARS = 50 * 1024;
const COMMAND_PATTERN = /^[/\\][a-z-]+/i;

export interface MessagePart {
  type: string;
  text?: string;
  synthetic?: boolean;
  ignored?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  sessionID?: string;
  finish?: string;
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
  messageId: string;
  /** Session this turn belongs to, propagated through `PromptBoundary`. */
  sessionID?: string;
  /**
   * True when the underlying message contained plugin/orchestrator
   * scaffolding. Polluted turns get an empty `text` so downstream filters
   * that look at `text.length > 0` will skip them automatically.
   */
  polluted?: boolean;
}

export interface SignalExtractionConfig {
  signalKeywords: string[];
  signalTurnsBefore: number;
}

export function groupIntoTurns(messages: Message[]): Turn[] {
  return messages.map((message) => {
    const boundary = createPromptBoundary(message.parts, { sessionID: message.sessionID, role: message.role });
    return {
      role: message.role,
      text: boundary.userText,
      messageId: message.id,
      sessionID: boundary.sessionID,
      polluted: boundary.isPolluted,
    };
  });
}

// Word characters that anchor a `\b` boundary in JS regex. Used to decide
// whether a keyword that starts/ends with a word char needs a `\b` guard.
const WORD_CHAR = /\w/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a single regex that matches any of the supplied keywords as
 * WHOLE WORDS (case-insensitive). Word-boundary anchors are added only on
 * sides that begin/end with a word character — keywords like `<sm:off>`
 * or `?!` stay literal-matchable without breaking the boundary semantics.
 *
 * Returns `null` when the input list yields no usable patterns.
 */
function compileKeywordPattern(keywords: string[]): RegExp | null {
  const parts: string[] = [];
  for (const raw of keywords) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const escaped = escapeRegex(trimmed);
    const left = WORD_CHAR.test(trimmed[0] ?? "") ? "\\b" : "";
    const right = WORD_CHAR.test(trimmed[trimmed.length - 1] ?? "") ? "\\b" : "";
    parts.push(`${left}${escaped}${right}`);
  }
  if (parts.length === 0) return null;
  return new RegExp(`(?:${parts.join("|")})`, "i");
}

export function findSignalTurns(turns: Turn[], keywords: string[]): number[] {
  const pattern = compileKeywordPattern(keywords.map((k) => k.toLowerCase()));
  if (!pattern) return [];

  return turns.reduce<number[]>((indices, turn, index) => {
    if (!isDetectableUserTurn(turn)) return indices;

    // Strip fenced ```...``` and inline `...` code first — a keyword sitting
    // inside a quoted code/spec block should NOT trigger capture. This
    // matches the behavior of `chat/keywords.detectMemoryKeyword` so both
    // surfaces use the same matching contract.
    const stripped = removeCodeBlocks(turn.text);

    if (pattern.test(stripped)) {
      indices.push(index);
    }
    return indices;
  }, []);
}

export function getContextualTurns(turns: Turn[], signalIndices: number[], turnsBefore: number): Turn[] {
  const collectedIndices = new Set<number>();
  const safeTurnsBefore = Math.max(0, Math.floor(turnsBefore));

  for (const signalIndex of signalIndices) {
    const startIndex = Math.max(0, signalIndex - safeTurnsBefore);
    const endIndex = Math.min(turns.length - 1, signalIndex);

    for (let index = startIndex; index <= endIndex; index += 1) {
      collectedIndices.add(index);
    }
  }

  return [...collectedIndices]
    .sort((left, right) => left - right)
    .map((index) => turns[index])
    .filter((turn): turn is Turn => Boolean(turn));
}

export function extractSignalContent(messages: Message[], config: SignalExtractionConfig): string | null {
  const turns = groupIntoTurns(messages);
  const signalIndices = findSignalTurns(turns, config.signalKeywords);

  if (signalIndices.length === 0) {
    return null;
  }

  const contextualTurns = getContextualTurns(turns, signalIndices, config.signalTurnsBefore);
  const content = contextualTurns
    .map((turn) => `[${turn.role}] ${turn.text}`)
    .join("\n")
    .trim();

  return content.length > 0 ? content : null;
}

function isDetectableUserTurn(turn: Turn): boolean {
  return turn.role === "user" && turn.text.length > 0 && turn.text.length <= MAX_SIGNAL_TURN_CHARS && !COMMAND_PATTERN.test(turn.text);
}
