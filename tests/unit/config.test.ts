import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const CONFIG_LOADER_SRC = join(REPO_ROOT, "src", "config", "loader.ts");
const FIXTURE_DIR = join(REPO_ROOT, "tests", "fixtures", "configs");

// =====================================================================
// Background — why a subprocess?
//
// config/loader caches the first resolved config returned by getConfig(). To
// exercise different fileConfig / env-var / credentials inputs we shell out
// to `bun -e` once per scenario, each
// with its own HOME (so the OS homedir() lookup is sandboxed) and its
// own SUPERMEMORY_API_KEY env. This keeps the assertions against the
// REAL src/config/loader.ts code (no in-process mocking of node:fs / auth).
// =====================================================================

interface ConfigEvalResult {
  config: {
    apiKey?: string | null;
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
      const mod = await import(${JSON.stringify(CONFIG_LOADER_SRC)});
      const config = mod.getConfig();
      process.stdout.write(JSON.stringify({
        config,
        isConfigured: !!config.apiKey,
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
// Fixtures — locking shape of fileConfig => resolved config mapping
// =====================================================================

describe("loadConfig — fixture round-trips", () => {
  it("minimal.jsonc: apiKey is exported; every other field falls through to DEFAULTS", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: readFixture("minimal.jsonc") },
    });
    expect(res.config.apiKey).toBe("sm_test_minimal_0001");
    expect(res.isConfigured).toBe(true);
    // Pins the documented DEFAULTS.
    expect(res.config.similarityThreshold).toBe(0.6);
    expect(res.config.maxMemories).toBe(5);
    expect(res.config.maxProjectMemories).toBe(10);
    expect(res.config.maxProfileItems).toBe(5);
    expect(res.config.injectProfile).toBe(true);
    expect(res.config.containerTagPrefix).toBe("opencode");
    expect(res.config.compactionThreshold).toBe(0.8);
  });

  it("maximal.jsonc: every field flows through verbatim, including custom container tags", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: readFixture("maximal.jsonc") },
    });
    expect(res.config.apiKey).toBe("sm_test_maximal_0002");
    expect(res.config.similarityThreshold).toBe(0.72);
    expect(res.config.maxMemories).toBe(8);
    expect(res.config.maxProjectMemories).toBe(12);
    expect(res.config.maxProfileItems).toBe(6);
    expect(res.config.injectProfile).toBe(true);
    expect(res.config.containerTagPrefix).toBe("omsm-test");
    expect(res.config.userContainerTag).toBe("team-platform");
    expect(res.config.projectContainerTag).toBe("opencode-supermemory-fixture");
    expect(res.config.filterPrompt).toBe("Test filter prompt. Remember user preferences only.");
    expect(res.config.compactionThreshold).toBe(0.75);
    // User-supplied patterns are MERGED with DEFAULT_KEYWORD_PATTERNS — not replaced.
    expect(res.config.keywordPatterns).toEqual([
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
    expect(res.config.apiKey).toBe("sm_test_with_comments_0003");
    expect(res.config.similarityThreshold).toBe(0.65);
    expect(res.config.containerTagPrefix).toBe("omsm");
  });

  it("with-trailing-commas.jsonc: trailing commas before } and ] are tolerated", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: readFixture("with-trailing-commas.jsonc") },
    });
    expect(res.config.apiKey).toBe("sm_test_trailing_commas_0004");
    // User patterns merged after DEFAULT_KEYWORD_PATTERNS; duplicates are NOT deduped today.
    // Pins current behavior: "remember", "save\\s+this", "note\\s+this" appear twice each.
    expect(res.config.keywordPatterns.filter((p) => p === "remember").length).toBe(2);
    expect(res.config.keywordPatterns.filter((p) => p === "save\\s+this").length).toBe(2);
  });

  it("mixed-quotes.jsonc: escaped quotes, URLs, and string-internal // remain intact", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: readFixture("mixed-quotes.jsonc") },
    });
    expect(res.config.apiKey).toBe('sm_test_mixed_"quotes"_0005');
    expect(res.config.filterPrompt).toContain("// not-a-comment");
    expect(res.config.filterPrompt).toContain("/* still-not-a-comment */");
    expect(res.config.containerTagPrefix).toBe('omsm-mixed-"escapes"');
    // Every user pattern is a valid regex, so all of them are appended.
    expect(res.config.keywordPatterns).toContain("url:\\s*https?://[^\\s]+");
    expect(res.config.keywordPatterns).toContain("path:\\s*/[^\\s]+");
  });

  it("malformed.jsonc: loadConfig swallows the JSON.parse error and falls through to {} -> DEFAULTS", async () => {
    // Locks current behavior: the try/catch in loadConfig() makes invalid
    // JSONC silently equivalent to a missing file. Every config field is
    // the DEFAULTS value; apiKey is absent (no env, no creds).
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: readFixture("malformed.jsonc") },
    });
    expect(res.config.apiKey ?? null).toBeNull();
    expect(res.isConfigured).toBe(false);
    expect(res.config.similarityThreshold).toBe(0.6);
    expect(res.config.maxMemories).toBe(5);
    expect(res.config.injectProfile).toBe(true);
    expect(res.config.containerTagPrefix).toBe("opencode");
    expect(res.config.compactionThreshold).toBe(0.8);
  });

  it("no config file present: every field equals the documented DEFAULTS and apiKey is null", async () => {
    const res = await evalConfig({});
    expect(res.config.apiKey ?? null).toBeNull();
    expect(res.isConfigured).toBe(false);
    expect(res.config).toEqual({
      apiKey: undefined,
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
    expect(res.config.apiKey).toBe("sm_from_env");
  });

  it("falls through to the config file apiKey when env is unset (file > credentials)", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: FILE_KEY },
      credentialsContent: CRED_FILE,
    });
    expect(res.config.apiKey).toBe("sm_from_file");
  });

  it("falls through to credentials.json apiKey when env and file are absent", async () => {
    const res = await evalConfig({
      credentialsContent: CRED_FILE,
    });
    expect(res.config.apiKey).toBe("sm_from_credentials");
  });

  it("returns null and `isConfigured() === false` when no source provides an apiKey", async () => {
    const res = await evalConfig({});
    expect(res.config.apiKey ?? null).toBeNull();
    expect(res.isConfigured).toBe(false);
  });

  it(".jsonc takes precedence over .json when both exist", async () => {
    // config file discovery in src/config/loader.ts iterates .jsonc first, .json second.
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
        const mod = await import(${JSON.stringify(CONFIG_LOADER_SRC)});
        process.stdout.write(JSON.stringify({ apiKey: mod.getConfig().apiKey ?? null }));
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
    expect(res.config.compactionThreshold).toBe(0.8);
  });

  it("compactionThreshold <= 0 → reverts to default", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: '{"compactionThreshold":0}' },
    });
    expect(res.config.compactionThreshold).toBe(0.8);
  });

  it("compactionThreshold = 1 (boundary) is accepted verbatim", async () => {
    // Locks the boundary: `value > 1` rejects, `value === 1` accepts.
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: '{"compactionThreshold":1}' },
    });
    expect(res.config.compactionThreshold).toBe(1);
  });

  it("compactionThreshold of wrong type (string) → reverts to default", async () => {
    // Pins the `typeof value !== "number"` guard.
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: '{"compactionThreshold":"high"}' },
    });
    expect(res.config.compactionThreshold).toBe(0.8);
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
    expect(res.config.keywordPatterns).toContain("remember");
    expect(res.config.keywordPatterns).toContain("never\\s+forget");
    // Valid user patterns are appended.
    expect(res.config.keywordPatterns).toContain("valid_pattern");
    expect(res.config.keywordPatterns).toContain("another\\d+");
    // Invalid regex is filtered out by `isValidRegex`.
    expect(res.config.keywordPatterns).not.toContain("[unclosed");
  });

  it("user-supplied empty keywordPatterns array leaves only the 16 DEFAULT_KEYWORD_PATTERNS", async () => {
    const res = await evalConfig({
      configFile: { name: "supermemory.jsonc", content: '{"keywordPatterns":[]}' },
    });
    expect(res.config.keywordPatterns).toHaveLength(16);
    expect(res.config.keywordPatterns[0]).toBe("remember");
    expect(res.config.keywordPatterns[15]).toBe("always\\s+remember");
  });
});

// =====================================================================
// Zod schema — exercised in-process (the new src/config/* modules are pure
// and have no top-level side effects, so we can import and call directly).
// =====================================================================

describe("SupermemoryConfigSchema — in-process zod validation", () => {
  it("parse({}) returns every default field — apiKey/userContainerTag/projectContainerTag stay undefined", async () => {
    const { SupermemoryConfigSchema } = await import("../../src/config/schema.ts");
    const result = SupermemoryConfigSchema.parse({});
    expect(result.apiKey).toBeUndefined();
    expect(result.userContainerTag).toBeUndefined();
    expect(result.projectContainerTag).toBeUndefined();
    expect(result.similarityThreshold).toBe(0.6);
    expect(result.maxMemories).toBe(5);
    expect(result.maxProjectMemories).toBe(10);
    expect(result.maxProfileItems).toBe(5);
    expect(result.injectProfile).toBe(true);
    expect(result.containerTagPrefix).toBe("opencode");
    expect(result.compactionThreshold).toBe(0.8);
    expect(result.keywordPatterns).toEqual([]);
  });

  it("per-field .catch() recovers silently from wrong-type input", async () => {
    const { SupermemoryConfigSchema } = await import("../../src/config/schema.ts");
    // Every field gets a string where its declared type expects something else.
    const result = SupermemoryConfigSchema.parse({
      similarityThreshold: "not-a-number",
      maxMemories: "five",
      maxProjectMemories: false,
      maxProfileItems: null,
      injectProfile: "yes",
      containerTagPrefix: 42,
      filterPrompt: 123,
      keywordPatterns: "not-an-array",
      compactionThreshold: { nested: true },
    });
    expect(result.similarityThreshold).toBe(0.6);
    expect(result.maxMemories).toBe(5);
    expect(result.maxProjectMemories).toBe(10);
    expect(result.maxProfileItems).toBe(5);
    expect(result.injectProfile).toBe(true);
    expect(result.containerTagPrefix).toBe("opencode");
    expect(result.filterPrompt).toContain("You are a stateful coding agent");
    expect(result.keywordPatterns).toEqual([]);
    expect(result.compactionThreshold).toBe(0.8);
  });

  it("compactionThreshold range gate: (0, 1] — boundary 1 accepted, 0 rejected, > 1 rejected", async () => {
    const { SupermemoryConfigSchema } = await import("../../src/config/schema.ts");
    expect(SupermemoryConfigSchema.parse({ compactionThreshold: 1 }).compactionThreshold).toBe(1);
    expect(SupermemoryConfigSchema.parse({ compactionThreshold: 0.5 }).compactionThreshold).toBe(0.5);
    expect(SupermemoryConfigSchema.parse({ compactionThreshold: 0 }).compactionThreshold).toBe(0.8);
    expect(SupermemoryConfigSchema.parse({ compactionThreshold: -0.1 }).compactionThreshold).toBe(0.8);
    expect(SupermemoryConfigSchema.parse({ compactionThreshold: 1.5 }).compactionThreshold).toBe(0.8);
    expect(SupermemoryConfigSchema.parse({ compactionThreshold: NaN }).compactionThreshold).toBe(0.8);
  });
});

describe("loadConfig / getConfig — lazy in-process API", () => {
  it("loadConfig({ homeDir, env }) returns DEFAULTS when no config file or env apiKey is present", async () => {
    const { loadConfig } = await import("../../src/config/loader.ts");
    const tmpHome = createTmpDir("loader-defaults");
    try {
      const result = loadConfig({ homeDir: tmpHome, env: {} });
      expect(result.apiKey).toBeUndefined();
      expect(result.similarityThreshold).toBe(0.6);
      expect(result.maxMemories).toBe(5);
      // DEFAULT_KEYWORD_PATTERNS is always merged in.
      expect(result.keywordPatterns).toHaveLength(16);
      expect(result.keywordPatterns[0]).toBe("remember");
    } finally {
      cleanupTmpDir(tmpHome);
    }
  });

  it("loadConfig({ env: { SUPERMEMORY_API_KEY } }) honours env even when no file is present", async () => {
    const { loadConfig } = await import("../../src/config/loader.ts");
    const tmpHome = createTmpDir("loader-env");
    try {
      const result = loadConfig({ homeDir: tmpHome, env: { SUPERMEMORY_API_KEY: "sm_from_env_inproc" } });
      expect(result.apiKey).toBe("sm_from_env_inproc");
    } finally {
      cleanupTmpDir(tmpHome);
    }
  });

  it("loadConfig reads ~/.config/opencode/supermemory.jsonc when present", async () => {
    const { loadConfig } = await import("../../src/config/loader.ts");
    const tmpHome = createTmpDir("loader-jsonc");
    try {
      mkdirSync(join(tmpHome, ".config", "opencode"), { recursive: true });
      writeFileSync(
        join(tmpHome, ".config", "opencode", "supermemory.jsonc"),
        '{"apiKey":"sm_from_file_inproc","similarityThreshold":0.91,"compactionThreshold":0.42}',
      );
      const result = loadConfig({ homeDir: tmpHome, env: {} });
      expect(result.apiKey).toBe("sm_from_file_inproc");
      expect(result.similarityThreshold).toBe(0.91);
      expect(result.compactionThreshold).toBe(0.42);
    } finally {
      cleanupTmpDir(tmpHome);
    }
  });

  it("loadConfig silently drops invalid keywordPatterns regex strings while keeping defaults", async () => {
    const { loadConfig } = await import("../../src/config/loader.ts");
    const tmpHome = createTmpDir("loader-regex");
    try {
      mkdirSync(join(tmpHome, ".config", "opencode"), { recursive: true });
      writeFileSync(join(tmpHome, ".config", "opencode", "supermemory.jsonc"), '{"keywordPatterns":["valid_one","[unclosed","valid_two"]}');
      const result = loadConfig({ homeDir: tmpHome, env: {} });
      expect(result.keywordPatterns).toContain("remember"); // default survives
      expect(result.keywordPatterns).toContain("valid_one");
      expect(result.keywordPatterns).toContain("valid_two");
      expect(result.keywordPatterns).not.toContain("[unclosed");
    } finally {
      cleanupTmpDir(tmpHome);
    }
  });

  it("getConfig caches the first call; resetConfigCache forces a re-load", async () => {
    const { getConfig, resetConfigCache } = await import("../../src/config/loader.ts");
    resetConfigCache();
    const a = getConfig();
    const b = getConfig();
    expect(a).toBe(b); // identity equality — cached singleton
    resetConfigCache();
    const c = getConfig();
    expect(c).not.toBe(a); // fresh object after reset
    expect(c).toEqual(a); // ...but structurally identical (same env/files)
  });
});
