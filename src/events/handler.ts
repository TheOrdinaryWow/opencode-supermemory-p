/**
 * Thin delegate for the OpenCode `event` plugin hook. Forwards every
 * event to the compaction hook (when configured) and returns. The hook
 * body in `src/index.ts` is intentionally tiny so the heavy lifting
 * stays in `src/compaction/` where it can be unit-tested in isolation.
 */

export interface EventInput {
  event: { type: string; properties?: unknown };
}

export interface EventDeps {
  compactionHook: { event(input: EventInput): Promise<void> } | null;
}

export async function handleEvent(input: EventInput, deps: EventDeps): Promise<void> {
  if (deps.compactionHook) {
    await deps.compactionHook.event(input);
  }
}
