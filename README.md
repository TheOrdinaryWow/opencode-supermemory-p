# opencode-supermemory-p

**The powered Supermemory plugin for OpenCode** — persistent memory using [Supermemory](https://supermemory.ai).

Your agent remembers what you tell it — across sessions, across projects.

## Table of Contents

- [Installation](#installation)
- [Disabling Per Project](#disabling-per-project)
- [Features](#features)
- [Tool Usage](#tool-usage)
- [Memory Scoping](#memory-scoping)
- [Configuration](#configuration)
- [Container Tags](#container-tags)
- [Usage with Oh My OpenAgent](#usage-with-oh-my-openagent)
- [Development](#development)
- [Logs](#logs)
- [Maintenance](#maintenance)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Installation

### For Humans

```bash
bunx opencode-supermemory-p@latest install
```

Then get your API key from [app.supermemory.ai](https://app.supermemory.ai/?view=integrations) and export it:

```bash
export SUPERMEMORY_API_KEY="sm_..."
```

**Or let your agent do it** — paste this into OpenCode:

```
Install opencode-supermemory-p by following https://raw.githubusercontent.com/TheOrdinaryWow/opencode-supermemory-p/refs/heads/main/README.md
```

### For LLM Agents

Non-interactive install (registers the plugin in `~/.config/opencode/opencode.jsonc` and creates `/supermemory-init`):

```bash
bunx opencode-supermemory-p@latest install --no-tui
```

API key resolution (highest priority first):

1. `SUPERMEMORY_API_KEY` env var.
2. `apiKey` field in `~/.config/opencode/supermemory-p.{jsonc,json}`.
3. OAuth credentials — run `bunx opencode-supermemory-p@latest login`.

**Verify**: restart OpenCode, run `opencode -c`, look for `supermemory` in the tools list. If missing, check `tail ~/.local/share/opencode-supermemory-p/log/main.log`.

**Initialize codebase memory** (optional): run `/supermemory-init` to have the agent explore and memorize the codebase.

### Disabling Per Project

To disable the plugin entirely for a single project, drop an empty `.supermemoryignore` file at the project root:

```bash
touch .supermemoryignore
```

When this file is present, the plugin loads but every hook becomes a no-op — no context injection, no capture, no compaction, no tool calls against Supermemory. The `SUPERMEMORY_API_KEY` is ignored for this project; other projects in the same OpenCode install are unaffected.

The check is presence-only (file contents are not parsed), matching the `.gitignore` / `.dockerignore` convention. Remove the file to re-enable the plugin.

## Features

### Context Injection

On the first message of every session, the agent silently receives:

- User profile (cross-project preferences)
- Project memories (all project knowledge)
- Relevant user memories (semantic search)

Example of what the agent sees:

```
[SUPERMEMORY]

User Profile:
- Prefers concise responses
- Expert in TypeScript

Project Knowledge:
- [100%] Uses Bun, not Node.js
- [100%] Build: bun run build

Relevant Memories:
- [82%] Build fails if .env.local missing
```

No manual prompting needed.

### Keyword Detection

Phrases like "remember", "save this", "don't forget" trigger an automatic memory save:

```
You: "Remember that this project uses bun"
Agent: [saves to project memory]
```

Add custom triggers via `keywordPatterns`.

### Codebase Indexing

Run `/supermemory-init` to explore and memorize your codebase structure, patterns, and conventions.

### Preemptive Compaction

When context hits `compactionThreshold` (default `0.8`):

1. Triggers OpenCode's summarization.
2. Injects project memories into the summary context.
3. Saves the session summary as a memory.

Conversation context survives the compaction event.

### Privacy

Content inside `<private>` tags is **never** stored:

```
API key is <private>sk-abc123</private>
```

Plugin / orchestrator scaffolding is also stripped at capture time — slash-command expansions, system reminders, `<Work_Context>` blocks, skill bodies, session-context wrappers, mode indicators, F-task briefs, and similar marker shapes. Whatever real user content surrounded them is preserved; messages that are 100% scaffolding leave nothing behind. To clean memories captured before this filter existed, see [Maintenance](#maintenance).

### Capture, recall, and display knobs

Each row is one entry in `~/.config/opencode/supermemory-p.jsonc`. See [Configuration](#configuration) for the full schema.

**Capture & retention**

| Option | Default | What it does |
| --- | --- | --- |
| `incrementalCapture` | `true` | Save assistant turns progressively as they finish |
| `maxCaptureChars` | `5000` | Per-turn capture size cap |
| `signalExtraction` | `true` | Heuristic keyword filter — keeps only turns that look worth saving |
| `signalKeywords` | preset list | Trigger phrases for the heuristic filter |
| `signalTurnsBefore` | `3` | Include this many turns before a matching turn |
| `sessionEndSave` | `true` | Final snapshot when the session ends or idles |
| `dedupEnabled` | `true` | Skip duplicate saves by normalized content hash |
| `dedupCacheSize` | `500` | Max entries in the dedup cache |

**Recall & injection**

| Option | Default | What it does |
| --- | --- | --- |
| `everyMessageRecall` | `false` | Run a recall search on every user message (extra API cost) |
| `recallKeywordPatterns` | preset list | Phrases that trigger an explicit recall search |
| `reinjectEveryN` | `0` | Re-inject memory every N completed turns (`0` disables) |
| `postCompactionReinject` | `true` | Re-inject memory after context compaction |
| `profileCrossArrayDedup` | `true` | Dedup profile facts across profile / project / relevant arrays |

**Display & metadata**

| Option | Default | What it does |
| --- | --- | --- |
| `metadataStripping` | `true` | Strip injected timestamps / tags from search queries (`<private>` preserved) |
| `relativeTimeDisplay` | `true` | Render timestamps as `2 hrs ago` instead of ISO strings |
| `memoUsageFooter` | `true` | Append a compact memory-count footer to injected context |
| `entityContext` | preset string | Short hint passed to the entity-extraction pipeline |
| `autoCategoryTagging` | `false` | Classify memories into `preference` / `decision` / etc. before storing |

Three options are off by default because they add API cost: `everyMessageRecall`, `reinjectEveryN`, `autoCategoryTagging`.

## Tool Usage

The `supermemory` tool is available to the agent:

| Mode      | Args                         | Description       |
| --------- | ---------------------------- | ----------------- |
| `add`     | `content`, `type?`, `scope?` | Store memory      |
| `search`  | `query`, `scope?`            | Search memories   |
| `profile` | `query?`                     | View user profile |
| `list`    | `scope?`, `limit?`           | List memories     |
| `forget`  | `memoryId`, `scope?`         | Delete memory     |

**Scopes:** `user` (cross-project), `project` (default).

**Types:** `project-config`, `architecture`, `error-solution`, `preference`, `learned-pattern`, `conversation`.

## Memory Scoping

| Scope   | Default tag                                  | Persists     |
| ------- | -------------------------------------------- | ------------ |
| User    | `opencode_user_{sha256(git_email)}`          | All projects |
| Project | `opencode_project_{sha256(owner/repo)}`      | This project |

The project tag formula is configurable — see [Container Tags](#container-tags).

## Configuration

Config lives in `~/.config/opencode/supermemory-p.jsonc`. All fields are optional and use safe defaults on missing / invalid values. `SUPERMEMORY_API_KEY` env var takes precedence over the file.

Use the published JSON Schema for editor completion and validation:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/TheOrdinaryWow/opencode-supermemory-p/refs/heads/main/assets/config.schema.json",
  // ...
}
```

### Core knobs

```jsonc
{
  // API key (env var SUPERMEMORY_API_KEY takes precedence)
  "apiKey": "sm_...",

  // Min similarity for memory retrieval (0-1)
  "similarityThreshold": 0.6,

  // Max memories injected per request
  "maxMemories": 5,

  // Max project memories listed
  "maxProjectMemories": 10,

  // Max profile facts injected
  "maxProfileItems": 5,

  // Include user profile in context
  "injectProfile": true,

  // Container tag generation — see "Container Tags" below
  "containerTagPrefix": "opencode",
  "projectTagStrategy": "hashGitRepoName",
  "userContainerTag": "my-custom-user-tag",      // optional override
  "projectContainerTag": "my-project-tag",       // optional override

  // System prompt used as the memory-ingestion filter directive
  "filterPrompt": "You are a stateful coding agent. Remember user's coding preferences, tech stack, and workflows.",

  // Extra keyword patterns for memory detection (regex)
  "keywordPatterns": ["log\\s+this", "write\\s+down"],

  // Context usage ratio that triggers compaction (0-1)
  "compactionThreshold": 0.8,
}
```

### Memory features (safe-on)

These default to enabled. See [Features](#capture-recall-and-display-knobs) for the per-row description.

```jsonc
{
  // Capture
  "incrementalCapture": true,
  "maxCaptureChars": 5000,
  "signalExtraction": true,
  "signalKeywords": ["remember", "save this", "important"],
  "signalTurnsBefore": 3,
  "sessionEndSave": true,
  "dedupEnabled": true,
  "dedupCacheSize": 500,

  // Recall
  "recallKeywordPatterns": ["bring that back", "look that up"],
  "postCompactionReinject": true,
  "profileCrossArrayDedup": true,

  // Display & metadata
  "metadataStripping": true,
  "relativeTimeDisplay": true,
  "memoUsageFooter": true,
  "entityContext": "Focus on people, projects, tools, and decisions that matter to this repository.",
}
```

### Opt-in features (costly-off)

These default to disabled because they add per-message API cost.

```jsonc
{
  // Run recall search on every message
  "everyMessageRecall": false,

  // Re-inject memory every N completed turns (0 disables)
  "reinjectEveryN": 0,

  // Classify memories into categories before storing them
  "autoCategoryTagging": false,
}
```

## Container Tags

Memories are scoped to "container tags". Two scopes exist:

| Scope   | Persists     | Default formula                              |
| ------- | ------------ | -------------------------------------------- |
| User    | All projects | `{prefix}_user_{sha256(git_email)}`          |
| Project | This project | depends on `projectTagStrategy` (see below)  |

`prefix` is `containerTagPrefix` (default `opencode`).

### Override

Set `userContainerTag` / `projectContainerTag` to use an exact string instead of the auto-generated value. Useful for:

- Sharing memories across teammates (same `userContainerTag`)
- Syncing memories between machines for the same project
- Integrating with existing Supermemory tags from other tools

### Project tag strategy

When `projectContainerTag` is **not** set, the project tag follows `projectTagStrategy`:

| Strategy           | Output                                                | Notes                                                                  |
| ------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `hashGitRepoName`  | `{prefix}_project_{sha256(owner/repo)}`               | **Default.** Stable across clones / machines for the same repo         |
| `rawGitRepoName`   | `{prefix}_project_{owner_repo}`                       | Human-readable; `/` becomes `_` to keep the tag path-safe              |
| `rawProjectName`   | `{prefix}_project_{basename(directory)}`              | Human-readable; uses the project directory name; no git lookup         |
| `hashDirectory`    | `{prefix}_project_{sha256(absolute_directory_path)}`  | Pre-existing behavior; tag changes if you move the checkout            |

Both git-backed strategies read `git config --get remote.origin.url` from the project directory and **fall back to `hashDirectory`** when:

- the directory is not inside a git repo,
- the repo has no `origin` remote, or
- the remote URL cannot be parsed into an `owner/repo` shape.

Example (remote `https://github.com/TheOrdinaryWow/abc`, prefix `my-prefix-`):

```jsonc
{ "containerTagPrefix": "my-prefix-", "projectTagStrategy": "hashGitRepoName" }
// → my-prefix-_project_{sha256("TheOrdinaryWow/abc")}

{ "containerTagPrefix": "my-prefix-", "projectTagStrategy": "rawGitRepoName" }
// → my-prefix-_project_TheOrdinaryWow_abc

{ "containerTagPrefix": "my-prefix-", "projectTagStrategy": "rawProjectName" }
// (in /Users/alice/code/abc) → my-prefix-_project_abc
```

## Usage with Oh My OpenAgent

If you're using [Oh My OpenAgent](https://github.com/code-yeongyu/oh-my-openagent), disable its built-in auto-compact hook so this plugin can handle context compaction:

Add to `~/.config/opencode/oh-my-openagent.json`:

```json
{
  "disabled_hooks": ["anthropic-context-window-limit-recovery"]
}
```

The installer detects Oh My OpenAgent and offers to do this for you. Use `--disable-context-recovery` to apply it non-interactively.

## Development

```bash
bun install
bun run build       # tsdown bundles dist/index.js (plugin) + dist/cli.js (CLI)
bun run typecheck
bun test            # 228 tests across unit, contract, and integration suites
bun run check       # biome lint + format with --write
```

Local install — point your OpenCode config at the working tree:

```jsonc
{
  "plugin": ["file:///path/to/opencode-supermemory-p"],
}
```

Contributor guidance for agents: see [`AGENTS.md`](./AGENTS.md).

## Logs

```bash
tail -f ~/.local/share/opencode-supermemory-p/log/main.log
```

Override path via `OPENCODE_SUPERMEMORY_LOG`. Override level via `OPENCODE_SUPERMEMORY_LOG_LEVEL` (`trace` / `debug` / `info` / `warning` / `error` / `fatal`; legacy alias `warn` → `warning`).

## Maintenance

### Purge legacy plugin-injected memories

Memories captured by earlier versions of this plugin may contain content injected by other plugins (slash-command expansions, system reminders, `<Work_Context>` blocks, mode indicators, etc.). The `purge-injected` script scans the Supermemory backend and removes any memory whose stored text still matches a known scaffolding pattern.

Dry-run (default — lists matches without deleting):

```bash
bun run scripts/purge-injected.ts
```

Confirm deletion:

```bash
bun run scripts/purge-injected.ts --confirm
```

The script reads `SUPERMEMORY_API_KEY` from the environment or `~/.config/opencode/supermemory-p.jsonc`. Override with `--api-key sm_...` or `--base-url https://...` if needed.

## Acknowledgements

This plugin builds on the work of the Supermemory team and the wider community of plugin authors. In particular:

- [opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory) — the upstream OpenCode plugin this fork is based on.
- [claude-supermemory](https://github.com/supermemoryai/claude-supermemory) — source of the entity-context, dedup, and signal-extraction patterns.
- [openclaw-supermemory](https://github.com/supermemoryai/openclaw-supermemory) — source of the incremental-capture, metadata-stripping, and compaction-hook designs.
- [opencode-supermemory-max](https://github.com/kandotrun/opencode-supermemory-max) — community fork that informed several of the feature consolidations here.

Thanks to everyone who shipped these projects.

## License

MIT
