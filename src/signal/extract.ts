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
}

export interface SignalExtractionConfig {
  signalKeywords: string[];
  signalTurnsBefore: number;
}

export function groupIntoTurns(messages: Message[]): Turn[] {
  return messages.map((message) => ({
    role: message.role,
    text: message.parts
      .filter((part) => part.type === "text" && typeof part.text === "string" && !part.synthetic && !part.ignored)
      .map((part) => part.text)
      .join("\n")
      .trim(),
    messageId: message.id,
  }));
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
      return [...indices, index];
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
