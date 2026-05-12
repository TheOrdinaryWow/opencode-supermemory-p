/**
 * Tracks which sessions have already received the one-shot Supermemory
 * context-injection on their first `chat.message`. Lives in-process for
 * the lifetime of the plugin — no persistence, no cross-process sharing.
 *
 * The original implementation in `src/index.ts` exposed a raw
 * `Set<string>` through the plugin closure, which leaked an
 * implementation detail (the choice of `Set`) into every consumer.
 * `createSessionState()` returns a small object with three named
 * operations so that the storage strategy can evolve (e.g. a TTL cache
 * or a database) without touching every call site.
 */

export interface SessionState {
  /** Record that `sessionId` has been seen and context has been injected. */
  markInjected(sessionId: string): void;
  /** Returns true if `markInjected` was previously called for this id. */
  wasInjected(sessionId: string): boolean;
  /** Remove `sessionId` from the tracker, e.g. on session close. */
  forget(sessionId: string): void;
}

export function createSessionState(): SessionState {
  const injectedSessions = new Set<string>();
  return {
    markInjected(sessionId: string): void {
      injectedSessions.add(sessionId);
    },
    wasInjected(sessionId: string): boolean {
      return injectedSessions.has(sessionId);
    },
    forget(sessionId: string): void {
      injectedSessions.delete(sessionId);
    },
  };
}
