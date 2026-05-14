# AGENTS.md

OpenCode plugin that adds Supermemory persistent memory to coding agents. Shipped as an npm package with two entrypoints: an in-process plugin (`dist/index.js`) and a `bunx`-able CLI installer (`dist/cli.js`).

User docs live in [`README.md`](./README.md). This file captures the repo-specific things an agent would otherwise guess wrong.

## Stack

- **Runtime / package manager**: Bun. Lockfile is `bun.lock` (binary). All scripts assume Bun — do not switch to npm/pnpm.
- **Language**: TypeScript, strict mode, ESM only (`"type": "module"`), `verbatimModuleSyntax`, `noUncheckedIndexedAccess`.
- **Bundler**: [tsdown](https://tsdown.dev/) (not tsup, not vite). Config: `tsdown.config.ts`.
- **Lint / format**: Biome (not ESLint / Prettier). Config: `biome.json`. Width 140, double quotes, trailing commas all, semicolons always. Imports are auto-grouped — let the formatter handle it.
- **Tests**: Bun's native runner (`bun test`). No vitest / jest. Helpers are built on `bun:test` primitives.
- **Path aliases**: `@/*` → `src/*`, `@cli/*` → `cli/*`. Use them — Biome's organize-imports groups them in a specific order.

## Common commands

```bash
bun install
bun run check       # biome check --write    (lint + format + organize imports)
bun run typecheck   # tsc --noEmit
bun run build       # runs gen:schema first, then tsdown — see "Build" below
bun test            # whole suite
bun test tests/unit/<file>.test.ts   # single file
```

CI runs (`bunx biome ci` → `bun run typecheck` → `bun run build` → `bun test`) in `.github/workflows/ci.yml`. Match that order locally before pushing.

## Build (non-obvious)

`bun run build` does **two** things:

1. `bun scripts/gen-schema.ts` — regenerates `assets/config.schema.json` from the Zod schema in [`src/config/schema.ts`](./src/config/schema.ts). **Never hand-edit `assets/config.schema.json`** — it gets overwritten. CI guards this via `bun run check:schema` (regen + `git diff --exit-code`). When you change any `SupermemoryConfigSchema` field, commit the regenerated JSON together with the source change.
2. `tsdown` emits two bundles:
   - `dist/index.js` (plugin, ESM). Keeps `@opencode-ai/plugin`, `supermemory`, `citty` as external deps. A custom plugin in `tsdown.config.ts` rewrites the default-export syntax — if you touch the public export shape of `src/index.ts`, re-check that block.
   - `dist/cli.js` (CLI, ESM with shebang). Bundles `citty`, `fs-extra`, `jsonc-parser`, `zod` inline. A `build:done` hook copies `cli/templates/` → `dist/templates/` — new CLI templates must live in `cli/templates/` to ship.

## Repo layout

```
src/
  index.ts          OpenCode plugin entrypoint. Declares hooks, builds deps in createDeps().
  chat/             chat.message hook — context injection, keyword nudge, recall.
  events/           generic `event` hook dispatch.
  compaction/       experimental.session.compacting hook + pre/post compaction handling.
  capture/          incremental capture + session-end save + tracker filesystem state.
  signal/           heuristic signal-keyword extraction (no LLM call).
  recall/           every-message + periodic re-injection logic.
  memory/           Supermemory client, tag computation, dedup, context formatting, privacy strip.
  tool/             implementation of the `supermemory` tool the agent calls.
  config/           schema (Zod) + loader + defaults. Single source of truth for config shape.
  auth/             OAuth flow for the CLI `login` / `logout` commands.
  session/          per-process session state (which sessions have been injected).
  shared/           Result, AppError, logger, jsonc parser, id generator, user-prompt sanitizer.
  types/            shared types used across modules.

cli/
  index.ts          citty entrypoint. Subcommands: install, setup, login, logout, version.
  commands/         one file per subcommand.
  templates/        markdown templates copied into ~/.config/opencode/command/ by install.

tests/
  unit/             one file per module. Use Bun's mock + setSystemTime + mock.module.
  integration/      hook-level behaviour, plugin smoke, CLI commands.
  contract/         plugin shape + tool-modes contract.
  helpers/          tmpdir / mock-fs / mock-fetch / mock-exec / mock-time. See tests/README.md.
  fixtures/         static JSONC configs, message samples, git setup script.

scripts/
  gen-schema.ts     Zod → JSON Schema. Runs as part of `bun run build`.
  purge-injected.ts Maintenance: removes legacy polluted memories. README has user docs.
  release.sh        LEGACY. Do not use. Releases go through release-please (see "Release").
```

## Conventions (honor these when editing)

- **Errors**: expected failures return `Result<T, AppError>` from [`src/shared/result.ts`](./src/shared/result.ts) — not thrown exceptions. `AppError` is a closed discriminated union in [`src/shared/errors.ts`](./src/shared/errors.ts). Add new variants to that union rather than introducing new error classes.
- **Two client surfaces**: [`src/memory/client.ts`](./src/memory/client.ts) exposes a Result-typed `SupermemoryClient`. [`src/index.ts`](./src/index.ts#L123) wraps it with `createLegacyClient` into a "success/error" shape consumed by chat / tool modules. The deps object carries both (`client` = legacy, `resultClient` = Result-typed). When adding a new consumer, prefer `resultClient` and the Result type.
- **Hooks must never throw**. Every hook body in `src/chat/handler.ts`, `src/events/handler.ts`, `src/compaction/*.ts` wraps its work in `try/catch` and logs the error. Preserve that — OpenCode surfaces hook exceptions to the user.
- **Config is silent-recovery**: every field in `SupermemoryConfigSchema` uses `.catch(default)` so bad user values get coerced, not rejected. The loader's `readFileConfig` similarly returns `{}` on parse failure. Do not introduce hard validation errors at the config layer.
- **Tags are cached per-process**. `getGitEmail()` and `getGitRepoName()` in [`src/memory/tags.ts`](./src/memory/tags.ts) cache `execSync` results. Tests must call `resetTagsCache()` between cases.
- **No emoji in committed docs** unless explicitly requested. Existing `README.md` uses a couple sparingly — match that level, don't escalate.

## Tests

- Run with `bun test`. Three tiers: `unit/`, `integration/`, `contract/`.
- `tests/helpers/` is **dependency-free apart from `bun:test` and `node:*`**. Helpers must NOT import from `src/` — this is structural, not stylistic.
- `mock-fetch` is **strict**: any unregistered URL throws `Error('unmocked URL: <url>')`. Register every URL your test hits.
- Several config / loader tests run inside `Bun.spawn(["bun", "-e", ...])` to redirect `HOME` and env vars. Read the existing test before adding a new one — most modules already have a pattern to follow.
- Fixtures in `tests/fixtures/` are static. Don't mutate them; build dynamic content inside the test itself.
- Full test infra documented in [`tests/README.md`](./tests/README.md).

## Release

- Driven by [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml` + `.github/release-please-config.json`).
- **Commits must follow Conventional Commits.** User-visible types: `feat`, `fix`, `perf`, `refactor`, `docs`. Hidden in changelog: `chore`, `ci`, `build`, `style`, `test`. Anything else gets ignored.
- Publishing uses npm provenance + OIDC trusted publisher — no manual `NPM_TOKEN`. `workflow_dispatch` with `publish_current=true` can republish the current `package.json` version (bootstrap / hotfix path).
- `scripts/release.sh` predates release-please and is **legacy**. Do not run it; it will diverge from the actual release flow.
- Do not commit changes unless the user explicitly asks. This applies even when changes look "done".

## Runtime / install paths

- **Plugin log**: `~/.local/share/opencode-supermemory-p/log/main.log` (rotating, 1 MiB × 5). Override via `OPENCODE_SUPERMEMORY_LOG`. Level via `OPENCODE_SUPERMEMORY_LOG_LEVEL` (logtape levels: `trace`/`debug`/`info`/`warning`/`error`/`fatal`; legacy alias `warn` → `warning`).
- **Dedup cache**: `~/.local/share/opencode-supermemory-p/dedup.json` (flushed on `beforeExit`).
- **OAuth credentials**: `~/.local/share/opencode-supermemory-p/credentials.json` (third-priority `apiKey` source after env and config file).
- **User config**: `~/.config/opencode/supermemory-p.{jsonc,json}` (`.jsonc` preferred). API-key resolution order: `SUPERMEMORY_API_KEY` env → config file `apiKey` → OAuth credentials file.
- **Local dev install**: in `~/.config/opencode/opencode.jsonc`, add `"plugin": ["file:///abs/path/to/this/repo"]`. Restart OpenCode after rebuild.

## OpenCode plugin contract

- Plugin hooks declared in `package.json` under `opencode.hooks`: `chat.message`, `event`. Runtime also wires `tool.supermemory` and `experimental.session.compacting` — those are not in the manifest by design (they're implicit from the return shape of the plugin factory).
- The factory in `src/index.ts` short-circuits to no-op handlers when `apiKey` is unset, so the plugin never breaks an OpenCode session when uninstalled-but-loaded.
