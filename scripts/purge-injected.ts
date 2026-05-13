/**
 * Purge memories that were poisoned by other-plugin injections (typically
 * oh-my-openagent's `<system-reminder>`, `<auto-slash-command>`,
 * `<session-context>`, `[SYSTEM DIRECTIVE: ...]`, or the OMO_INTERNAL_INITIATOR
 * marker) before this plugin learned to filter them at capture time.
 *
 * Run modes:
 *   bun run scripts/purge-injected.ts                  # dry-run (default)
 *   bun run scripts/purge-injected.ts --confirm        # actually delete
 *   bun run scripts/purge-injected.ts --api-key ...    # override env
 *   bun run scripts/purge-injected.ts --base-url ...   # override default
 *
 * The script re-uses the same pattern set as
 * `sanitizeMemoryContextForInjection` so the dry-run preview matches what the
 * runtime sanitizer would strip.
 *
 * Pure functions (`findPolluted`, `listAllMemories`, `deleteMemories`) are
 * exported and unit-tested independently of HTTP and stdout. The `runPurge`
 * function and the entry guard at the bottom orchestrate them.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { stripJsoncComments } from "@/shared/jsonc";

export const POLLUTION_PATTERNS: ReadonlyArray<RegExp> = [
  // Plugin block wrappers (OMO and similar)
  /<(?:auto-slash-command|command-instruction|session-context|system-reminder|supermemory-context|user-request|user-task)\b/i,
  // Sisyphus orchestrator scaffold wrapper
  /<Work_Context\b/,
  // Skill tool output — SKILL.md bodies are not user-typed content
  /<skill_content\b/i,
  /<available_skills\b/i,
  // System directives
  /\[SYSTEM DIRECTIVE:/i,
  /\[restore checkpointed session/i,
  /<!--\s*OMO_INTERNAL_INITIATOR\s*-->/i,
  // Sisyphus task briefs / plan management / mode indicators
  /^[\t ]*## F\d+:/m,
  /^[\t ]*## Auto-Selected Plan[\t ]*$/m,
  /^[\t ]*## Plan Not Found\b/m,
  /^[\t ]*boulder\.json has been created\./m,
  /^[\t ]*\[(?:analyze|search|deep|ultrawork|ultrabrain|artistry|writing|quick|visual-engineering|unspecified-(?:low|high))-mode\][\t ]*$/m,
  // Standalone scaffolding signature strings
  /You are starting a Sisyphus work session\./,
  /MANDATORY delegate_task params:/,
];

export interface MemoryRecord {
  id: string;
  summary?: string | null;
  content?: string | null;
  title?: string | null;
  containerTags?: string[];
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface PollutionMatch {
  id: string;
  pattern: string;
  preview: string;
  containerTags: string[];
  createdAt?: string;
}

export interface PurgeApi {
  listPage(page: number, limit: number): Promise<{ memories: MemoryRecord[]; pagination?: { currentPage: number; totalPages: number } }>;
  deleteMemory(id: string): Promise<{ ok: boolean; status: number }>;
}

export interface DeleteResult {
  deleted: string[];
  failed: Array<{ id: string; status: number }>;
}

/**
 * Walk every memory and return matches against `POLLUTION_PATTERNS`.
 * Stops at the FIRST pattern hit per memory so the count reflects unique
 * polluted records, not pattern occurrences.
 */
export function findPolluted(memories: readonly MemoryRecord[], patterns: ReadonlyArray<RegExp> = POLLUTION_PATTERNS): PollutionMatch[] {
  const matches: PollutionMatch[] = [];
  for (const memory of memories) {
    const text = [memory.summary, memory.content, memory.title].filter(Boolean).join("\n");
    if (!text) continue;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        matches.push({
          id: memory.id,
          pattern: pattern.source,
          preview: text.slice(0, 200),
          containerTags: memory.containerTags ?? [],
          createdAt: memory.createdAt,
        });
        break;
      }
    }
  }
  return matches;
}

/**
 * Paginate `api.listPage` until exhausted. Defensive against:
 *   - APIs that ignore the `page` parameter (returns same data; we detect
 *     by counting added entries and stop when none are new).
 *   - Runaway pagination metadata (we cap at `safetyLimit`).
 *
 * Dedups by `id` across pages.
 */
export async function listAllMemories(api: PurgeApi, options: { pageSize?: number; safetyLimit?: number } = {}): Promise<MemoryRecord[]> {
  const pageSize = options.pageSize ?? 100;
  const safetyLimit = options.safetyLimit ?? 200;
  const all = new Map<string, MemoryRecord>();
  let page = 1;

  while (page <= safetyLimit) {
    const response = await api.listPage(page, pageSize);
    if (!response.memories || response.memories.length === 0) break;

    let added = 0;
    for (const memory of response.memories) {
      if (!all.has(memory.id)) {
        all.set(memory.id, memory);
        added += 1;
      }
    }

    if (added === 0) break;

    const pagination = response.pagination;
    if (!pagination || pagination.currentPage >= pagination.totalPages) break;

    page += 1;
  }

  return [...all.values()];
}

/**
 * Sequentially delete each id and partition by HTTP success.
 * Sequential (not parallel) to keep API rate-limit pressure predictable.
 */
export async function deleteMemories(api: PurgeApi, ids: readonly string[]): Promise<DeleteResult> {
  const result: DeleteResult = { deleted: [], failed: [] };
  for (const id of ids) {
    const response = await api.deleteMemory(id);
    if (response.ok) {
      result.deleted.push(id);
    } else {
      result.failed.push({ id, status: response.status });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// CLI orchestration (not unit-tested directly; runs against real Supermemory)
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://api.supermemory.ai/v3";

interface CliOptions {
  apiKey: string;
  baseUrl: string;
  confirm: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let apiKey = process.env.SUPERMEMORY_API_KEY ?? "";
  let baseUrl = DEFAULT_BASE_URL;
  let confirm = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--api-key") apiKey = argv[++i] ?? "";
    else if (arg === "--base-url") baseUrl = argv[++i] ?? baseUrl;
    else if (arg === "--confirm") confirm = true;
  }

  if (!apiKey) {
    apiKey = readApiKeyFromConfig() ?? "";
  }

  return { apiKey, baseUrl, confirm };
}

function readApiKeyFromConfig(): string | null {
  const candidates = [
    join(homedir(), ".config", "opencode", "supermemory-p.jsonc"),
    join(homedir(), ".config", "opencode", "supermemory.jsonc"),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(stripJsoncComments(raw)) as { apiKey?: string };
      if (parsed.apiKey) return parsed.apiKey;
    } catch {
      // ignore — try next candidate
    }
  }
  return null;
}

function makeHttpApi(baseUrl: string, apiKey: string): PurgeApi {
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  return {
    async listPage(page, limit) {
      const response = await fetch(`${baseUrl}/memories/list`, {
        method: "POST",
        headers,
        body: JSON.stringify({ page, limit }),
      });
      if (!response.ok) {
        throw new Error(`list page=${page} failed: ${response.status} ${await response.text()}`);
      }
      return (await response.json()) as Awaited<ReturnType<PurgeApi["listPage"]>>;
    },

    async deleteMemory(id) {
      const response = await fetch(`${baseUrl}/memories/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return { ok: response.ok, status: response.status };
    },
  };
}

export async function runPurge(
  api: PurgeApi,
  options: { confirm: boolean },
  log: (line: string) => void = console.log,
): Promise<DeleteResult | null> {
  log("Listing memories…");
  const memories = await listAllMemories(api);
  log(`Total: ${memories.length}`);

  const polluted = findPolluted(memories);
  log(`Polluted: ${polluted.length} (${memories.length === 0 ? 0 : ((polluted.length / memories.length) * 100).toFixed(1)}%)`);

  if (polluted.length === 0) {
    log("Nothing to purge.");
    return null;
  }

  log("");
  log("Sample (up to 5):");
  const sampled = new Set<string>();
  for (const match of polluted) {
    const sig = match.preview.slice(0, 60);
    if (sampled.has(sig)) continue;
    sampled.add(sig);
    log(`  [${match.id}] (${match.pattern}) ${match.preview.replace(/\s+/g, " ")}…`);
    if (sampled.size >= 5) break;
  }

  if (!options.confirm) {
    log("");
    log("Dry-run only. Re-run with --confirm to delete.");
    return null;
  }

  log("");
  log(`Deleting ${polluted.length} memories…`);
  const result = await deleteMemories(
    api,
    polluted.map((p) => p.id),
  );
  log(`Deleted: ${result.deleted.length}`);
  if (result.failed.length > 0) log(`Failed:  ${result.failed.length}`);
  return result;
}

const isCliEntry = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const options = parseArgs(process.argv.slice(2));
  if (!options.apiKey) {
    console.error("ERROR: SUPERMEMORY_API_KEY not set and no apiKey found in ~/.config/opencode/supermemory-p.jsonc.");
    process.exit(1);
  }
  const api = makeHttpApi(options.baseUrl, options.apiKey);
  runPurge(api, { confirm: options.confirm }).catch((error) => {
    console.error(`purge failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
