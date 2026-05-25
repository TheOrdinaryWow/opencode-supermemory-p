/**
 * Per-session opt-out.
 *
 * Whole-project disable already exists via `.supermemoryignore`. This
 * module adds a softer, per-conversation switch the user can flip mid-
 * session. Useful when:
 *   - You are pasting sensitive content for a single turn.
 *   - You are debugging or chatting ABOUT the plugin itself and don't
 *     want the conversation to feed back into project memories.
 *   - You're inside a sub-agent / experiment you don't want indexed.
 *
 * Markers (matched anywhere in the raw user message text — code blocks
 * included, so users can paste them safely inside ``` fences):
 *
 *   <supermemory:off />   — disable capture/recall for this session
 *   <supermemory:on />    — re-enable
 *
 * Both markers are also stripped at capture time so the assistant never
 * sees them in `userText` (handled in user-prompt SCAFFOLDING_PATTERNS).
 *
 * State is process-local. A killed-and-restarted OpenCode loses the
 * disable list; persisting it across restarts is intentionally NOT done
 * because the opt-out is per-conversation, not per-machine.
 */

import { registerSessionCleaner } from "@/session/reaper";

export const DISABLE_MARKER = /<supermemory:off\s*\/?>/i;
export const ENABLE_MARKER = /<supermemory:on\s*\/?>/i;

const disabledSessions = new Set<string>();

registerSessionCleaner((sessionID) => disabledSessions.delete(sessionID));

export function isSessionDisabled(sessionID: string | undefined): boolean {
  if (!sessionID) return false;
  return disabledSessions.has(sessionID);
}

/**
 * Inspect raw user text for opt-out markers and update the disable set.
 * Returns the NEW disabled state for the session. Caller is responsible
 * for short-circuiting downstream work when this returns true.
 *
 * `<supermemory:on />` wins when both markers appear in the same message
 * (covers paste-then-undo: turn it back on at the end of your message).
 */
export function updateSessionDisabledFromText(sessionID: string, rawText: string): boolean {
  if (!sessionID || !rawText) return disabledSessions.has(sessionID);

  const turnOn = ENABLE_MARKER.test(rawText);
  const turnOff = DISABLE_MARKER.test(rawText);

  if (turnOn) {
    disabledSessions.delete(sessionID);
  } else if (turnOff) {
    disabledSessions.add(sessionID);
  }

  return disabledSessions.has(sessionID);
}

/** Test-only: drop process-lifetime state so suites stay isolated. */
export function resetDisabledSessions(): void {
  disabledSessions.clear();
}
