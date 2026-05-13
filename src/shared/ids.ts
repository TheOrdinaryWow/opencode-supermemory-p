/**
 * Stateless ID generators for OpenCode messages and message parts.
 *
 * Both producers follow the canonical format:
 *   `${prefix}_${hexTimestamp}${base36Random}`
 *
 *   - prefix:        `msg` for messages, `prt` for parts
 *   - hexTimestamp:  `Date.now().toString(16)` — monotonic-ish, sortable
 *   - base36Random:  8 chars from `Math.random().toString(36).substring(2, 10)`
 *
 * The shape mirrors OpenCode's on-disk identifiers; do not change the prefix
 * or trim the random tail without coordinating with the message-store reader.
 */

const RANDOM_TAIL_START = 2;
const RANDOM_TAIL_END = 10;

function randomTail(): string {
  return Math.random().toString(36).substring(RANDOM_TAIL_START, RANDOM_TAIL_END);
}

export function generateMessageId(): string {
  return `msg_${Date.now().toString(16)}${randomTail()}`;
}

export function generatePartId(): string {
  return `prt_${Date.now().toString(16)}${randomTail()}`;
}
