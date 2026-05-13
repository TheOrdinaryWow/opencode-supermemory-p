# opencode-supermemory-p

**The powered Supermemory plugin for OpenCode** — persistent memory using [Supermemory](https://supermemory.ai).

Your agent remembers what you tell it — across sessions, across projects.

## Table of Contents

- [Installation](#installation)
- [Features](#features)
- [Tool Usage](#tool-usage)
- [Memory Scoping](#memory-scoping)
- [Configuration](#configuration)
- [Container Tag Selection](#container-tag-selection)
- [Project Tag Strategy](#project-tag-strategy)
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

Then get your API key from [app.supermemory.ai](https://app.supermemory.ai/?view=integrations) and set it:

```bash
export SUPERMEMORY_API_KEY="sm_..."
```

**Or let your agent do it** - paste this into OpenCode:

```
Install opencode-supermemory-p by following https://raw.githubusercontent.com/TheOrdinaryWow/opencode-supermemory-p/refs/heads/main/README.md
```

### For LLM Agents

<details>
<summary>Instructions for LLM Agents (click to expand)</summary>

If you're an LLM agent helping set up opencode-supermemory-p, follow these steps:

#### Step 1: Run the installer

```bash
bunx opencode-supermemory-p@latest install --no-tui
```

This will:

- Register the plugin in `~/.config/opencode/opencode.jsonc`
- Create the `/supermemory-init` command

#### Step 2: Verify the config

```bash
cat ~/.config/opencode/opencode.jsonc
```

Should contain:

```json
{
  "plugin": ["opencode-supermemory-p"]
}
```

If not, add it manually:

**JSONC:**

```jsonc
{
  "plugin": [
    "opencode-supermemory-p",
    // ... other plugins
  ],
}
```

**JSON:**

```json
{
  "plugin": ["opencode-supermemory-p"]
}
```

#### Step 3: Configure API key

Ask the user to get their API key from [app.supermemory.ai](https://app.supermemory.ai/?view=integrations).

Then set it via environment variable:

```bash
export SUPERMEMORY_API_KEY="sm_..."
```

Or create `~/.config/opencode/supermemory-p.jsonc`:

```jsonc
{
  "apiKey": "sm_...",
}
```

#### Step 4: Verify setup

Tell the user to restart OpenCode and run:

```bash
opencode -c
```

They should see `supermemory` in the tools list. If not, check:

1. Is `SUPERMEMORY_API_KEY` set?
2. Is the plugin in `opencode.jsonc`?
3. Check logs: `tail ~/.local/share/opencode-supermemory-p/log/main.log`

#### Step 5: Initialize codebase memory (optional)

Run `/supermemory-init` to have the agent explore and memorize the codebase.

</details>

## Features

### Context Injection

On first message, the agent receives (invisible to user):

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

The agent uses this context automatically - no manual prompting needed.

### Keyword Detection

Say "remember", "save this", "don't forget" etc. and the agent auto-saves to memory.

```
You: "Remember that this project uses bun"
Agent: [saves to project memory]
```

Add custom triggers via `keywordPatterns` config.

### Codebase Indexing

Run `/supermemory-init` to explore and memorize your codebase structure, patterns, and conventions.

### Preemptive Compaction

When context hits 80% capacity:

1. Triggers OpenCode's summarization
2. Injects project memories into summary context
3. Saves session summary as a memory

This preserves conversation context across compaction events.

### Privacy

```
API key is <private>sk-abc123</private>
```

Content in `<private>` tags is never stored.

### Incremental Capture

Assistant turns can be saved as they finish, which keeps long sessions from losing useful context. The capture limit is controlled by `maxCaptureChars`, so very large turns stay bounded.

### Every-Message Recall

This option runs memory search on every user message and re-injects the best matches when they matter. It is off by default because it adds retrieval cost on every turn.

### Signal Extraction

The plugin can watch for signal keywords and keep only the turns that look worth preserving. It stays heuristic-only, so no extra LLM call is needed for capture decisions.

### Content Dedup

Duplicate memories are skipped by content hash so the same fact does not get stored over and over. The cache is bounded and only stores hashes, which keeps the disk footprint small.

### Metadata Stripping

Injected timestamps, tags, and other wrapper metadata are removed before search. Private tags remain untouched, so the plugin still respects explicit private boundaries.

### Relative Time Display

Memory timestamps can render as relative text such as `2 hrs ago` instead of raw ISO strings. That keeps the injected context easier to scan during active sessions.

### Entity Context

Entity guidance gives memory extraction a short, focused hint about the current subject. It helps the plugin keep person, project, and product references consistent without adding extra API calls.

### Auto-Category Tagging

Memories can be classified into categories such as preference, decision, fact, or other. The feature is off by default so categorization only happens when you opt in.

### Memo Usage Footer

A compact footer can show how many memories were injected into the current context. That makes it easier to see when memory usage is high without opening logs.

### Profile Cross-Array Dedup

Profile facts can be deduped across the profile, project, and relevant-memory arrays before injection. That keeps repeated facts from crowding out fresher context.

### Recall Keywords

Extra recall phrases can trigger a search even when the message does not look like a normal memory request. This is useful for project-specific prompts that should always pull context back in.

### Periodic Re-Injection

The plugin can re-inject memory every N completed turns to keep long chats anchored. Set the interval to `0` to disable the cadence entirely.

### Session-End Save

When a session idles or ends, the plugin can write a final memory snapshot. That gives the conversation one last save point even if earlier capture was missed.

### Pre-Compaction Save

Before OpenCode compacts the conversation, the plugin can preserve the current state in full. This keeps the memory timeline intact before summarization trims the active context.

### Post-Compaction Re-Injection

After compaction, the plugin can queue the session for a fresh memory pull on the next chat turn. That restores useful context after the summary pass finishes.

## Tool Usage

The `supermemory` tool is available to the agent:

| Mode      | Args                         | Description       |
| --------- | ---------------------------- | ----------------- |
| `add`     | `content`, `type?`, `scope?` | Store memory      |
| `search`  | `query`, `scope?`            | Search memories   |
| `profile` | `query?`                     | View user profile |
| `list`    | `scope?`, `limit?`           | List memories     |
| `forget`  | `memoryId`, `scope?`         | Delete memory     |

**Scopes:** `user` (cross-project), `project` (default)

**Types:** `project-config`, `architecture`, `error-solution`, `preference`, `learned-pattern`, `conversation`

## Memory Scoping

| Scope   | Default tag                                  | Persists     |
| ------- | -------------------------------------------- | ------------ |
| User    | `opencode_user_{sha256(git_email)}`          | All projects |
| Project | `opencode_project_{sha256(owner/repo)}`      | This project |

The project tag formula is configurable via [`projectTagStrategy`](#project-tag-strategy).

## Configuration

### Migration Notes (v2)

All new features default to safe behavior (zero additional API cost). Three options require explicit opt-in: `everyMessageRecall`, `reinjectEveryN`, and `autoCategoryTagging`.

Create `~/.config/opencode/supermemory-p.jsonc`:

```jsonc
{
  // Editor completion & validation (optional)
  "$schema": "https://raw.githubusercontent.com/TheOrdinaryWow/opencode-supermemory-p/refs/heads/main/assets/config.schema.json",

  // API key (can also use SUPERMEMORY_API_KEY env var)
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

  // Prefix for container tags (used when userContainerTag/projectContainerTag not set)
  "containerTagPrefix": "opencode",

  // Optional: Set exact user container tag (overrides auto-generated tag)
  "userContainerTag": "my-custom-user-tag",

  // Optional: Set exact project container tag (overrides auto-generated tag)
  "projectContainerTag": "my-project-tag",

  // Project tag generation strategy: "hashDirectory" | "hashGitRepoName" | "rawGitRepoName"
  "projectTagStrategy": "hashGitRepoName",

  // System prompt used as the memory-ingestion filter directive
  "filterPrompt": "You are a stateful coding agent. Remember user's coding preferences, tech stack, and workflows.",

  // Extra keyword patterns for memory detection (regex)
  "keywordPatterns": ["log\\s+this", "write\\s+down"],

  // Context usage ratio that triggers compaction (0-1)
  "compactionThreshold": 0.8,

  // Save assistant turns progressively as they finish
  "incrementalCapture": true,

  // Maximum characters kept from any captured turn
  "maxCaptureChars": 5000,

  // Run recall search on every message (costly; default off)
  "everyMessageRecall": false,

  // Re-inject memory every N completed turns (0 disables it)
  "reinjectEveryN": 0,

  // Re-inject memory after context compaction
  "postCompactionReinject": true,

  // Save a final snapshot when the session ends or idles
  "sessionEndSave": true,

  // Keep only turns that match signal keywords
  "signalExtraction": true,

  // Keywords that trigger capture for high-signal turns
  "signalKeywords": ["remember", "save this", "important"],

  // Include this many earlier turns before a signal turn
  "signalTurnsBefore": 3,

  // Extra recall phrases that trigger a memory search
  "recallKeywordPatterns": ["bring that back", "look that up"],

  // Skip duplicate memory saves by normalized content hash
  "dedupEnabled": true,

  // Maximum number of entries kept in the dedup cache
  "dedupCacheSize": 500,

  // Short guidance for entity extraction during capture
  "entityContext": "Focus on people, projects, tools, and decisions that matter to this repository.",

  // Strip injected metadata from memory search queries
  "metadataStripping": true,

  // Show relative timestamps like '2 hrs ago' in memory context
  "relativeTimeDisplay": true,

  // Append a compact memory-count footer to injected context
  "memoUsageFooter": true,

  // Classify memories into categories before storing them
  "autoCategoryTagging": false,

  // Deduplicate profile facts across profile, project, and relevant memories
  "profileCrossArrayDedup": true,
}
```

All fields optional. Env var `SUPERMEMORY_API_KEY` takes precedence over config file.

### Container Tag Selection

By default, container tags are auto-generated using `containerTagPrefix`:

- User tag: `{prefix}_user_{sha256(git_email)}`
- Project tag: depends on [`projectTagStrategy`](#project-tag-strategy) (defaults to `hashGitRepoName`)

You can override this by specifying exact container tags:

```jsonc
{
  // Use a specific container tag for user memories
  "userContainerTag": "my-team-workspace",

  // Use a specific container tag for project memories
  "projectContainerTag": "my-awesome-project",
}
```

This is useful when you want to:

- Share memories across team members (same `userContainerTag`)
- Sync memories between different machines for the same project
- Organize memories using your own naming scheme
- Integrate with existing Supermemory container tags from other tools

### Project Tag Strategy

When `projectContainerTag` is **not** set, the project tag is auto-generated according to `projectTagStrategy`:

| Strategy           | Output                                                | Notes                                                          |
| ------------------ | ----------------------------------------------------- | -------------------------------------------------------------- |
| `hashGitRepoName`  | `{prefix}_project_{sha256(owner/repo)}`               | **Default.** Stable across clones / machines for the same repo |
| `rawGitRepoName`   | `{prefix}_project_{owner.repo}`                       | Human-readable; `/` becomes `_` to keep the tag path-safe      |
| `hashDirectory`    | `{prefix}_project_{sha256(absolute_directory_path)}`  | Pre-existing behavior; tag changes if you move the checkout    |

Both git-backed strategies read `git config --get remote.origin.url` from the project directory and **fall back to `hashDirectory`** when:

- the directory is not inside a git repo, or
- the repo has no `origin` remote, or
- the remote URL cannot be parsed into an `owner/repo` shape.

Example resolution (HTTPS or SSH remote of `https://github.com/TheOrdinaryWow/abc`, prefix `my-prefix-`):

```jsonc
{
  "containerTagPrefix": "my-prefix-",
  "projectTagStrategy": "hashGitRepoName"
}
// → my-prefix-_project_{sha256("TheOrdinaryWow/abc")}

{
  "containerTagPrefix": "my-prefix-",
  "projectTagStrategy": "rawGitRepoName"
}
// → my-prefix-_project_TheOrdinaryWow.abc
```

## Usage with Oh My OpenAgent

If you're using [Oh My OpenAgent](https://github.com/code-yeongyu/oh-my-openagent), disable its built-in auto-compact hook to let supermemory handle context compaction:

Add to `~/.config/opencode/oh-my-openagent.json`:

```json
{
  "disabled_hooks": ["anthropic-context-window-limit-recovery"]
}
```

Messages containing plugin or orchestrator scaffolding (slash-command expansions, system reminders, `<Work_Context>` blocks, skill bodies, session-context wrappers, mode indicators, etc.) are skipped entirely from the capture stream. Memories ingested with this plugin enabled will not contain other plugins' markers, so no manual cleanup is needed for new sessions. To clean up memories captured before this filtering existed, see [Maintenance](#maintenance).

## Development

```bash
bun install
bun run build       # tsdown bundles dist/index.js (plugin) + dist/cli.js (CLI)
bun run typecheck
bun test            # 228 tests across unit, contract, and integration suites
bun run check       # biome lint + format with --write
```

Local install:

```jsonc
{
  "plugin": ["file:///path/to/opencode-supermemory-p"],
}
```

## Logs

```bash
tail -f ~/.local/share/opencode-supermemory-p/log/main.log
```

## Maintenance

### Purge legacy plugin-injected memories

Memories captured by earlier versions of this plugin may contain content injected by other plugins (slash-command expansions, system reminders, etc.). The `purge-injected` script scans the Supermemory backend and removes them.

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
