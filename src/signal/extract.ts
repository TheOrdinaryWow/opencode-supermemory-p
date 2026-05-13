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
      text: boundary.isPolluted ? "" : boundary.userText,
      messageId: message.id,
      sessionID: boundary.sessionID,
      polluted: boundary.isPolluted,
    };
  });
}

export function findSignalTurns(turns: Turn[], keywords: string[]): number[] {
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase()).filter((keyword) => keyword.length > 0);

  if (normalizedKeywords.length === 0) {
    return [];
  }

  return turns.reduce<number[]>((indices, turn, index) => {
    if (!isDetectableUserTurn(turn)) {
      return indices;
    }

    const normalizedText = turn.text.toLowerCase();

    if (normalizedKeywords.some((keyword) => normalizedText.includes(keyword))) {
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
