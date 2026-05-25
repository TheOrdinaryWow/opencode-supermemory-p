/**
 * Cross-module session reaper.
 *
 * Many modules in this plugin keep per-session state in process-lifetime
 * `Set<string>` / `Map<string, T>` keyed by `sessionID`. Without a reaper
 * each long-lived OpenCode process accumulates one entry per ended session
 * forever — a slow leak that nobody trips over in tests but shows up as
 * tens of MB of resident state after a few thousand sessions.
 *
 * Each module that holds sessionID-keyed state should register a cleaner
 * here at module-init time. The event dispatcher calls `reapSession(id)`
 * on `session.deleted`, which fans out to every registered cleaner.
 *
 * Cleaners MUST be:
 *   - Synchronous and non-throwing — they run inside an event hook.
 *   - Idempotent — the same sessionID may be reaped more than once if
 *     `session.deleted` fires after a `session.idle` that also cleaned up.
 */

type SessionCleaner = (sessionID: string) => void;

const cleaners = new Set<SessionCleaner>();

export function registerSessionCleaner(cleaner: SessionCleaner): () => void {
  cleaners.add(cleaner);
  return () => {
    cleaners.delete(cleaner);
  };
}

export function reapSession(sessionID: string): void {
  for (const cleaner of cleaners) {
    try {
      cleaner(sessionID);
    } catch {
      // Cleaners must be infallible. A bad cleaner cannot stop the rest.
    }
  }
}

/** Test-only: drop every registered cleaner. */
export function resetSessionReaper(): void {
  cleaners.clear();
}
