import { setSystemTime } from "bun:test";

/**
 * Pin `Date.now()` and `new Date()` to a fixed instant.
 *
 * Accepts a `Date`, a Unix timestamp in milliseconds, or any string the
 * `Date` constructor can parse (ISO 8601 strongly recommended).
 *
 * Pair every call with {@link resetTime} in `afterEach`/`afterAll` to
 * avoid leaking fake time into unrelated tests.
 */
export function setFakeTime(time: Date | number | string): void {
  const d = time instanceof Date ? time : new Date(time);
  setSystemTime(d);
}

/**
 * Restore `Date.now()` to the real wall clock. Idempotent.
 */
export function resetTime(): void {
  setSystemTime();
}

// ---------------------------------------------------------------------
// setTimeout / setInterval virtual clock
// ---------------------------------------------------------------------

interface ScheduledTimer {
  id: number;
  fn: (...args: unknown[]) => void;
  args: unknown[];
  dueAt: number;
  intervalMs?: number;
}

let virtualClockNow = 0;
let nextTimerId = 1;
let pending: ScheduledTimer[] = [];

let originalSetTimeout: typeof setTimeout | undefined;
let originalClearTimeout: typeof clearTimeout | undefined;
let originalSetInterval: typeof setInterval | undefined;
let originalClearInterval: typeof clearInterval | undefined;
let timersFaked = false;

/**
 * Switch `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`
 * to an internal virtual clock. Callbacks never fire on their own —
 * you must advance the clock with {@link advanceTime}.
 *
 * Combine with {@link setFakeTime} if your code reads `Date.now()` as
 * well; otherwise wall-clock and virtual-clock will drift.
 */
export function useFakeTimers(): void {
  if (timersFaked) return;
  timersFaked = true;
  virtualClockNow = Date.now();
  pending = [];
  nextTimerId = 1;

  originalSetTimeout = globalThis.setTimeout;
  originalClearTimeout = globalThis.clearTimeout;
  originalSetInterval = globalThis.setInterval;
  originalClearInterval = globalThis.clearInterval;

  const fakeSetTimeout = ((fn: (...args: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    const id = nextTimerId++;
    pending.push({ id, fn, args, dueAt: virtualClockNow + Math.max(0, ms) });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  const fakeClearTimeout = ((id: unknown) => {
    pending = pending.filter((t) => t.id !== id);
  }) as typeof clearTimeout;

  const fakeSetInterval = ((fn: (...args: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    const id = nextTimerId++;
    const interval = Math.max(1, ms);
    pending.push({ id, fn, args, dueAt: virtualClockNow + interval, intervalMs: interval });
    return id as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;

  const fakeClearInterval = ((id: unknown) => {
    pending = pending.filter((t) => t.id !== id);
  }) as typeof clearInterval;

  globalThis.setTimeout = fakeSetTimeout;
  globalThis.clearTimeout = fakeClearTimeout;
  globalThis.setInterval = fakeSetInterval;
  globalThis.clearInterval = fakeClearInterval;
}

/**
 * Advance the virtual clock by `ms` milliseconds, firing any timers
 * scheduled in the new window in due-time order. Recursively fires
 * timers that schedule new timers within the same window.
 *
 * Requires {@link useFakeTimers} to be active.
 */
export function advanceTime(ms: number): void {
  if (!timersFaked) {
    throw new Error("advanceTime: useFakeTimers() must be called first");
  }
  const target = virtualClockNow + Math.max(0, ms);
  // Loop until no more timers fall within the target window.
  // Each iteration picks the soonest-due timer and fires it.
  while (true) {
    const due = pending.filter((t) => t.dueAt <= target).sort((a, b) => a.dueAt - b.dueAt)[0];
    if (!due) break;
    virtualClockNow = due.dueAt;
    // Remove (or reschedule for intervals) before invoking, so the
    // callback observes a consistent queue.
    pending = pending.filter((t) => t.id !== due.id);
    if (due.intervalMs !== undefined) {
      pending.push({ ...due, dueAt: due.dueAt + due.intervalMs });
    }
    due.fn(...due.args);
  }
  virtualClockNow = target;
}

/**
 * Restore the real `setTimeout` family. Drops all pending fake timers.
 */
export function useRealTimers(): void {
  if (!timersFaked) return;
  timersFaked = false;
  pending = [];
  if (originalSetTimeout) globalThis.setTimeout = originalSetTimeout;
  if (originalClearTimeout) globalThis.clearTimeout = originalClearTimeout;
  if (originalSetInterval) globalThis.setInterval = originalSetInterval;
  if (originalClearInterval) globalThis.clearInterval = originalClearInterval;
}
