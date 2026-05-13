# tests/

Test infrastructure for opencode-supermemory-p.

This directory contains the safety net used by the architecture refactor:
helpers for isolating filesystem / network / process / time effects, plus
fixtures for the data shapes we operate on.

## Layout

```
tests/
├── helpers/
│   ├── tmpdir.ts        // per-test scratch directories with auto-cleanup
│   ├── mock-fs.ts       // in-memory fs (dependency-injected)
│   ├── mock-fetch.ts    // strict global fetch interceptor
│   ├── mock-exec.ts     // execSync interceptor (DI or global module mock)
│   ├── mock-time.ts     // Date.now() + setTimeout virtual clock
│   └── __sanity__.test.ts
└── fixtures/
    ├── configs/         // JSONC sample configs (minimal..malformed)
    ├── messages/        // chat message samples (privacy, code blocks)
    └── git/setup.sh     // reproducible local git fixture
```

Use Bun's native test runner: `bun test tests/helpers/`. No additional
mock framework is required — every helper is built on top of `bun:test`
primitives (`mock`, `setSystemTime`, `mock.module`).

## Helpers

### `tmpdir.ts`

```ts
import { createTmpDir, cleanupTmpDir, useTmpDir } from "./helpers/tmpdir";

// Manual lifecycle — caller cleans up.
const dir = createTmpDir("my-feature");
// ... write files into `dir` ...
cleanupTmpDir(dir);

// Or scope to a describe block:
describe("my feature", () => {
  const dir = useTmpDir("my-feature"); // afterAll cleanup auto-registered
  it("writes a file", () => { /* use dir */ });
});
```

### `mock-fs.ts`

Dependency-injectable in-memory filesystem. Pass a `MockFs` to code that
accepts an `FsLike` parameter — do **not** monkey-patch `node:fs`.

```ts
import { createMockFs } from "./helpers/mock-fs";

const fs = createMockFs({
  "/etc/config.json": '{"apiKey":"sm_test"}',
});
expect(fs.existsSync("/etc/config.json")).toBe(true);
expect(fs.readFileSync("/etc/config.json", "utf-8")).toContain("sm_test");
expect(() => fs.readFileSync("/missing", "utf-8")).toThrow(/ENOENT/);
```

### `mock-fetch.ts` (strict)

Replaces `globalThis.fetch`. **Any request to an unregistered URL throws
`Error('unmocked URL: <url>')`** — this is by design, to make every
network dependency explicit.

```ts
import {
  installMockFetch,
  uninstallMockFetch,
  mockFetch,
  resetMockFetch,
} from "./helpers/mock-fetch";

beforeAll(() => installMockFetch());
afterAll(() => uninstallMockFetch());
beforeEach(() => resetMockFetch());

it("queries the API", async () => {
  mockFetch("https://api.example.com/users", new Response('[{"id":1}]'));
  const res = await fetch("https://api.example.com/users");
  expect(await res.json()).toEqual([{ id: 1 }]);
});

it("blows up on accidental real-network calls", async () => {
  expect(fetch("https://prod.example.com/")).rejects.toThrow(/unmocked URL/);
});
```

Matchers: `string` (substring match) or `RegExp`. First match wins.

### `mock-exec.ts`

Two modes:

1. **DI mode** — `createMockExec()` returns an instance you can pass
   into code that accepts an exec-like function.

   ```ts
   const exec = createMockExec();
   exec.register("git config user.email", "test@example.com\n");
   expect(exec.exec("git config user.email")).toBe("test@example.com\n");
   expect(() => exec.exec("rm -rf /")).toThrow(/unmocked exec command/);
   ```

2. **Module-mock mode** — `installExecMock(instance)` patches
   `node:child_process` via `mock.module`. All other exports keep their
   real behaviour. Use this when production code does
   `import { execSync } from "node:child_process"` directly.

### `mock-time.ts`

Built on Bun's `setSystemTime`. Adds a manually-advanced virtual clock
for `setTimeout`/`setInterval`.

```ts
import { setFakeTime, resetTime, useFakeTimers, advanceTime, useRealTimers } from "./helpers/mock-time";

setFakeTime("2026-01-15T12:00:00Z");
expect(new Date().toISOString()).toBe("2026-01-15T12:00:00.000Z");

useFakeTimers();
let fired = false;
setTimeout(() => { fired = true; }, 1000);
advanceTime(999); expect(fired).toBe(false);
advanceTime(1);   expect(fired).toBe(true);
useRealTimers();
resetTime();
```

## Fixtures

### `configs/`

Six JSONC samples exercising the boundaries of `stripJsoncComments`:

| File                       | What it covers                                       |
| -------------------------- | ---------------------------------------------------- |
| `minimal.jsonc`            | Single field, no comments                            |
| `maximal.jsonc`            | Every `SupermemoryConfig` field populated            |
| `with-comments.jsonc`      | Line `//` and block `/* */` comments                 |
| `with-trailing-commas.jsonc` | Trailing commas in arrays and objects             |
| `mixed-quotes.jsonc`       | Escaped quotes, URLs in strings, fake comments       |
| `malformed.jsonc`          | Intentionally invalid (unclosed object)              |

### `messages/`

Three chat-message samples for privacy and content-shape tests:

| File                     | What it covers                          |
| ------------------------ | --------------------------------------- |
| `with-private-tag.md`    | Mixed public + `<private>` content      |
| `fully-private.md`       | Entirely inside one `<private>` tag     |
| `with-code-blocks.md`    | Fenced code blocks (must survive intact)|

### `git/setup.sh`

Bootstraps a reproducible local git repo: `user.email=test@example.com`,
`user.name=Test User`, one empty initial commit. Always exits 0 on
success. Idempotent — safe to re-run.

## Conventions

- Helpers MUST NOT import from `src/`. They are dependency-free apart
  from `bun:test` and `node:*`.
- Tests live next to the helpers they exercise; for now only
  `__sanity__.test.ts` exists. Add focused test files (one per refactor
  target) as the refactor progresses.
- Fixtures are static text. If a test needs dynamic content, build it
  inside the test — do not mutate the fixture file on disk.
