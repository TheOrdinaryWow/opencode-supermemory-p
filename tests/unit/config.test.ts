import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const CONFIG_SRC = join(REPO_ROOT, "src", "config.ts");
const FIXTURE_DIR = join(REPO_ROOT, "tests", "fixtures", "configs");

// =====================================================================
// Background — why a subprocess?
//
// src/config.ts is "eager": both `SUPERMEMORY_API_KEY` and `CONFIG` are
// computed at module-evaluation time. Because Bun caches ESM modules
// per absolute path, re-importing config.ts in-process always returns
// the FIRST evaluation. To exercise different fileConfig / env-var /
// credentials inputs we shell out to `bun -e` once per scenario, each
// with its own HOME (so the OS homedir() lookup is sandboxed) and its
// own SUPERMEMORY_API_KEY env. This keeps the assertions against the
// REAL src/config.ts code (no in-process mocking of node:fs / auth).
// =====================================================================

interface ConfigEvalResult {
  SUPERMEMORY_API_KEY: string | null;
  CONFIG: {
    similarityThreshold: number;
    maxMemories: number;
    maxProjectMemories: number;
    maxProfileItems: number;
    injectProfile: boolean;
    containerTagPrefix: string;
    userContainerTag?: string | null;
    projectContainerTag?: string | null;
    filterPrompt: string;
    keywordPatterns: string[];
    compactionThreshold: number;
  };
  isConfigured: boolean;
}

interface EvalOpts {
  /** Optional file at `~/.config/opencode/<name>`. */
  configFile?: { name: "supermemory.jsonc" | "supermemory.json"; content: string };
  /** Optional content of `~/.supermemory-opencode/credentials.json`. */
  credentialsContent?: string;
  /** Env overrides. `undefined` deletes the var; absent leaves parent default. */
  env?: Record<string, string | undefined>;
}

async function evalConfig(opts: EvalOpts = {}): Promise<ConfigEvalResult> {
  const tmpHome = createTmpDir("cfg-test");
  try {
    if (opts.configFile) {
      mkdirSync(join(tmpHome, ".config", "opencode"), { recursive: true });
      writeFileSync(join(tmpHome, ".config", "opencode", opts.configFile.name), opts.configFile.content);
    }
    if (opts.credentialsContent !== undefined) {
      mkdirSync(join(tmpHome, ".supermemory-opencode"), { recursive: true });
      writeFileSync(join(tmpHome, ".supermemory-opencode", "credentials.json"), opts.credentialsContent);
    }

    // Build env: start from parent so PATH/etc survive, override HOME, strip
    // any inherited SUPERMEMORY_API_KEY so tests are deterministic.
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    env.HOME = tmpHome;
    delete env.SUPERMEMORY_API_KEY;
    if (opts.env) {
      for (const [k, v] of Object.entries(opts.env)) {
        if (v === undefined) delete env[k];
        else env[k] = v;
      }
    }

    const script = `
      const mod = await import(${JSON.stringify(CONFIG_SRC)});
      process.stdout.write(JSON.stringify({
        SUPERMEMORY_API_KEY: mod.SUPERMEMORY_API_KEY ?? null,
        CONFIG: mod.CONFIG,
        isConfigured: mod.isConfigured(),
      }));
    `;

    const proc = Bun.spawn(["bun", "-e", script], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    if (proc.exitCode !== 0) {
      throw new Error(`config eval child exited ${proc.exitCode}\nstderr:\n${stderr}\nstdout:\n${stdout}`);
    }
    return JSON.parse(stdout) as ConfigEvalResult;
  } finally {
    cleanupTmpDir(tmpHome);
  }
}

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf-8");
}

// =====================================================================
// Fixtures — locking shape of fileConfig => CONFIG mapping
// =====================================================================

describe("loadConfig — fixture round-trips", () => {
  it("minimal.jsonc: apiKey is exported; every other field falls through to DEFAULTS", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: readFixture("minimal.jsonc") },
    });
    expect(res.SUPERMEMORY_API_KEY).toBe("sm_test_minimal_0001");
    expect(res.isConfigured).toBe(true);
    // Pins the documented DEFAULTS (src/config.ts §DEFAULTS).
    expect(res.CONFIG.similarityThreshold).toBe(0.6);
    expect(res.CONFIG.maxMemories).toBe(5);
    expect(res.CONFIG.maxProjectMemories).toBe(10);
    expect(res.CONFIG.maxProfileItems).toBe(5);
    expect(res.CONFIG.injectProfile).toBe(true);
    expect(res.CONFIG.containerTagPrefix).toBe("opencode");
    expect(res.CONFIG.compactionThreshold).toBe(0.8);
  });

  it("maximal.jsonc: every field flows through verbatim, including custom container tags", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: readFixture("maximal.jsonc") },
    });
    expect(res.SUPERMEMORY_API_KEY).toBe("sm_test_maximal_0002");
    expect(res.CONFIG.similarityThreshold).toBe(0.72);
    expect(res.CONFIG.maxMemories).toBe(8);
    expect(res.CONFIG.maxProjectMemories).toBe(12);
    expect(res.CONFIG.maxProfileItems).toBe(6);
    expect(res.CONFIG.injectProfile).toBe(true);
    expect(res.CONFIG.containerTagPrefix).toBe("omsm-test");
    expect(res.CONFIG.userContainerTag).toBe("team-platform");
    expect(res.CONFIG.projectContainerTag).toBe("opencode-supermemory-fixture");
    expect(res.CONFIG.filterPrompt).toBe("Test filter prompt. Remember user preferences only.");
    expect(res.CONFIG.compactionThreshold).toBe(0.75);
    // User-supplied patterns are MERGED with DEFAULT_KEYWORD_PATTERNS — not replaced.
    expect(res.CONFIG.keywordPatterns).toEqual([
      "remember",
      "memorize",
      "save\\s+this",
      "note\\s+this",
      "keep\\s+in\\s+mind",
      "don'?t\\s+forget",
      "learn\\s+this",
      "store\\s+this",
      "record\\s+this",
      "make\\s+a\\s+note",
      "take\\s+note",
      "jot\\s+down",
      "commit\\s+to\\s+memory",
      "remember\\s+that",
      "never\\s+forget",
      "always\\s+remember",
      "log\\s+this",
      "write\\s+down",
    ]);
  });

  it("with-comments.jsonc: line and block comments are stripped before parse", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: readFixture("with-comments.jsonc") },
    });
    expect(res.SUPERMEMORY_API_KEY).toBe("sm_test_with_comments_0003");
    expect(res.CONFIG.similarityThreshold).toBe(0.65);
    expect(res.CONFIG.containerTagPrefix).toBe("omsm");
  });

  it("with-trailing-commas.jsonc: trailing commas before } and ] are tolerated", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: readFixture("with-trailing-commas.jsonc") },
    });
    expect(res.SUPERMEMORY_API_KEY).toBe("sm_test_trailing_commas_0004");
    // User patterns merged after DEFAULT_KEYWORD_PATTERNS; duplicates are NOT deduped today.
    // Pins current behavior: "remember", "save\\s+this", "note\\s+this" appear twice each.
    expect(res.CONFIG.keywordPatterns.filter((p) => p === "remember").length).toBe(2);
    expect(res.CONFIG.keywordPatterns.filter((p) => p === "save\\s+this").length).toBe(2);
  });

  it("mixed-quotes.jsonc: escaped quotes, URLs, and string-internal // remain intact", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: readFixture("mixed-quotes.jsonc") },
    });
    expect(res.SUPERMEMORY_API_KEY).toBe('sm_test_mixed_"quotes"_0005');
    expect(res.CONFIG.filterPrompt).toContain("// not-a-comment");
    expect(res.CONFIG.filterPrompt).toContain("/* still-not-a-comment */");
    expect(res.CONFIG.containerTagPrefix).toBe('omsm-mixed-"escapes"');
    // Every user pattern is a valid regex, so all of them are appended.
    expect(res.CONFIG.keywordPatterns).toContain("url:\\s*https?://[^\\s]+");
    expect(res.CONFIG.keywordPatterns).toContain("path:\\s*/[^\\s]+");
  });

  it("malformed.jsonc: loadConfig swallows the JSON.parse error and falls through to {} -> DEFAULTS", async () => {
    // Locks current behavior: the try/catch in loadConfig() makes invalid
    // JSONC silently equivalent to a missing file. Every CONFIG field is
    // the DEFAULTS value; SUPERMEMORY_API_KEY is null (no env, no creds).
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: readFixture("malformed.jsonc") },
    });
    expect(res.SUPERMEMORY_API_KEY).toBeNull();
    expect(res.isConfigured).toBe(false);
    expect(res.CONFIG.similarityThreshold).toBe(0.6);
    expect(res.CONFIG.maxMemories).toBe(5);
    expect(res.CONFIG.injectProfile).toBe(true);
    expect(res.CONFIG.containerTagPrefix).toBe("opencode");
    expect(res.CONFIG.compactionThreshold).toBe(0.8);
  });

  it("no config file present: every field equals the documented DEFAULTS and apiKey is null", async () => {
    const res = await evalConfig({});
    expect(res.SUPERMEMORY_API_KEY).toBeNull();
    expect(res.isConfigured).toBe(false);
    expect(res.CONFIG).toEqual({
      similarityThreshold: 0.6,
      maxMemories: 5,
      maxProjectMemories: 10,
      maxProfileItems: 5,
      injectProfile: true,
      containerTagPrefix: "opencode",
      filterPrompt:
        "You are a stateful coding agent. Remember all the information, including but not limited to user's coding preferences, tech stack, behaviours, workflows, and any other relevant details.",
      keywordPatterns: [
        "remember",
        "memorize",
        "save\\s+this",
        "note\\s+this",
        "keep\\s+in\\s+mind",
        "don'?t\\s+forget",
        "learn\\s+this",
        "store\\s+this",
        "record\\s+this",
        "make\\s+a\\s+note",
        "take\\s+note",
        "jot\\s+down",
        "commit\\s+to\\s+memory",
        "remember\\s+that",
        "never\\s+forget",
        "always\\s+remember",
      ],
      compactionThreshold: 0.8,
    });
  });
});

// =====================================================================
// API key priority — env > file > credentials
// =====================================================================

describe("getApiKey — priority order is env > config file > credentials.json", () => {
  const FILE_KEY = '{"apiKey":"sm_from_file"}';
  const CRED_FILE = JSON.stringify({ apiKey: "sm_from_credentials", createdAt: "2026-01-01" });

  it("uses SUPERMEMORY_API_KEY env var when all three are present", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: FILE_KEY },
      credentialsContent: CRED_FILE,
      env: { SUPERMEMORY_API_KEY: "sm_from_env" },
    });
    expect(res.SUPERMEMORY_API_KEY).toBe("sm_from_env");
  });

  it("falls through to the config file apiKey when env is unset (file > credentials)", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: FILE_KEY },
      credentialsContent: CRED_FILE,
    });
    expect(res.SUPERMEMORY_API_KEY).toBe("sm_from_file");
  });

  it("falls through to credentials.json apiKey when env and file are absent", async () => {
    const res = await evalConfig({
      credentialsContent: CRED_FILE,
    });
    expect(res.SUPERMEMORY_API_KEY).toBe("sm_from_credentials");
  });

  it("returns null and `isConfigured() === false` when no source provides an apiKey", async () => {
    const res = await evalConfig({});
    expect(res.SUPERMEMORY_API_KEY).toBeNull();
    expect(res.isConfigured).toBe(false);
  });

  it(".jsonc takes precedence over .json when both exist", async () => {
    // CONFIG_FILES list in src/config.ts iterates .jsonc first, .json second.
    // First existing-and-parseable wins, so .jsonc shadows .json.
    const tmpHome = createTmpDir("cfg-test-jsonc-vs-json");
    try {
      mkdirSync(join(tmpHome, ".config", "opencode"), { recursive: true });
      writeFileSync(join(tmpHome, ".config", "opencode", "supermemory.jsonc"), '{"apiKey":"sm_from_jsonc"}');
      writeFileSync(join(tmpHome, ".config", "opencode", "supermemory.json"), '{"apiKey":"sm_from_json"}');

      const env = { ...(process.env as Record<string, string>) };
      env.HOME = tmpHome;
      delete env.SUPERMEMORY_API_KEY;

      const script = `
        const mod = await import(${JSON.stringify(CONFIG_SRC)});
        process.stdout.write(JSON.stringify({ apiKey: mod.SUPERMEMORY_API_KEY ?? null }));
      `;
      const proc = Bun.spawn(["bun", "-e", script], { env, stdout: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      const parsed = JSON.parse(stdout);
      expect(parsed.apiKey).toBe("sm_from_jsonc");
    } finally {
      cleanupTmpDir(tmpHome);
    }
  });
});

// =====================================================================
// Validation — invalid inputs are silently coerced/dropped
// =====================================================================

describe("validateCompactionThreshold — out-of-range values fall back to default", () => {
  it("compactionThreshold > 1 → reverts to DEFAULTS.compactionThreshold (0.8)", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: '{"compactionThreshold":1.5}' },
    });
    expect(res.CONFIG.compactionThreshold).toBe(0.8);
  });

  it("compactionThreshold <= 0 → reverts to default", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: '{"compactionThreshold":0}' },
    });
    expect(res.CONFIG.compactionThreshold).toBe(0.8);
  });

  it("compactionThreshold = 1 (boundary) is accepted verbatim", async () => {
    // Locks the boundary: `value > 1` rejects, `value === 1` accepts.
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: '{"compactionThreshold":1}' },
    });
    expect(res.CONFIG.compactionThreshold).toBe(1);
  });

  it("compactionThreshold of wrong type (string) → reverts to default", async () => {
    // Pins the `typeof value !== "number"` guard.
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: '{"compactionThreshold":"high"}' },
    });
    expect(res.CONFIG.compactionThreshold).toBe(0.8);
  });
});

describe("keywordPatterns — DEFAULT_KEYWORD_PATTERNS always present, invalid regex filtered", () => {
  it("invalid regex patterns are silently dropped from the user-supplied list", async () => {
    const res = await evalConfig({
      configFile: {
        name: "supermemory.jsonc",
        content: '{"keywordPatterns":["valid_pattern","[unclosed","another\\\\d+"]}',
      },
    });
    // Defaults survive.
    expect(res.CONFIG.keywordPatterns).toContain("remember");
    expect(res.CONFIG.keywordPatterns).toContain("never\\s+forget");
    // Valid user patterns are appended.
    expect(res.CONFIG.keywordPatterns).toContain("valid_pattern");
    expect(res.CONFIG.keywordPatterns).toContain("another\\d+");
    // Invalid regex is filtered out by `isValidRegex`.
    expect(res.CONFIG.keywordPatterns).not.toContain("[unclosed");
  });

  it("user-supplied empty keywordPatterns array leaves only the 16 DEFAULT_KEYWORD_PATTERNS", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: '{"keywordPatterns":[]}' },
    });
    expect(res.CONFIG.keywordPatterns).toHaveLength(16);
    expect(res.CONFIG.keywordPatterns[0]).toBe("remember");
    expect(res.CONFIG.keywordPatterns[15]).toBe("always\\s+remember");
  });
});
