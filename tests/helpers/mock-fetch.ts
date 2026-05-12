import { mock } from "bun:test";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

/**
 * A registered responder. Either a static `Response` (cloned on each
 * match) or a function that builds one from the incoming request.
 */
export type FetchResponder = Response | ((req: { url: string; init?: FetchInit }) => Response | Promise<Response>);

interface MockEntry {
  matcher: string | RegExp;
  responder: FetchResponder;
}

const entries: MockEntry[] = [];
let originalFetch: typeof fetch | undefined;
let installed = false;

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

function matches(url: string, matcher: string | RegExp): boolean {
  if (typeof matcher === "string") return url.includes(matcher);
  return matcher.test(url);
}

/**
 * Replace `globalThis.fetch` with a strict mock. Any request to an
 * unregistered URL throws an error containing the literal string
 * `unmocked URL` — making it impossible to silently hit real services
 * during tests.
 *
 * Idempotent: calling twice is a no-op (the original `fetch` is captured
 * on the first install).
 */
export function installMockFetch(): void {
  if (installed) return;
  originalFetch = globalThis.fetch;
  installed = true;
  globalThis.fetch = mock(async (input: FetchInput, init?: FetchInit) => {
    const url = urlOf(input);
    for (const entry of entries) {
      if (matches(url, entry.matcher)) {
        const r = entry.responder;
        if (r instanceof Response) return r.clone();
        return await r({ url, init });
      }
    }
    throw new Error(`unmocked URL: ${url}`);
  }) as unknown as typeof fetch;
}

/**
 * Restore the original `globalThis.fetch` and forget all registered
 * responders. Safe to call when not installed.
 */
export function uninstallMockFetch(): void {
  entries.length = 0;
  if (!installed) return;
  if (originalFetch) globalThis.fetch = originalFetch;
  installed = false;
}

/**
 * Register a responder. Matchers are tried in registration order; the
 * first match wins.
 *
 * - `string` matcher → substring match against the full URL
 * - `RegExp` matcher → `regex.test(url)`
 */
export function mockFetch(matcher: string | RegExp, responder: FetchResponder): void {
  entries.push({ matcher, responder });
}

/**
 * Drop all registered responders without uninstalling. Useful between
 * tests when you want a fresh slate but keep the global mock active.
 */
export function resetMockFetch(): void {
  entries.length = 0;
}

/**
 * Inspect the currently registered matchers. Intended for assertions,
 * not for runtime branching.
 */
export function listMockFetchMatchers(): ReadonlyArray<string | RegExp> {
  return entries.map((e) => e.matcher);
}
