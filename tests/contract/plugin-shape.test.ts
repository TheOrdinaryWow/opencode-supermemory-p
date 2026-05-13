import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir";

const ROOT = process.cwd();
const BASELINE_DIR = join(ROOT, "tests", "fixtures", "baseline");

// Stub OpenCode plugin context — the minimum surface the factory touches
// during init (directory + a no-op provider list call).
function makeCtx() {
  return {
    directory: "/tmp/test",
    client: {
      provider: {
        list: async () => ({ data: { all: [] } }),
      },
    },
  } as never;
}

describe("plugin shape baseline", () => {
  let tmpHome: string;
  let previousLog: string | undefined;
  let previousApiKey: string | undefined;

  beforeAll(() => {
    // Bun's os.homedir() ignores process.env.HOME, so route the plugin log
    // explicitly into a tmp dir via the env override the logger honours.
    tmpHome = createTmpDir("plugin-shape-home");
    previousLog = process.env.OPENCODE_SUPERMEMORY_LOG;
    process.env.OPENCODE_SUPERMEMORY_LOG = join(tmpHome, "log", "main.log");
    // These tests pin the "no apiKey configured" shape. Ensure any
    // ambient env var from the developer's shell does not leak in.
    previousApiKey = process.env.SUPERMEMORY_API_KEY;
    delete process.env.SUPERMEMORY_API_KEY;
  });

  afterAll(() => {
    if (previousLog === undefined) delete process.env.OPENCODE_SUPERMEMORY_LOG;
    else process.env.OPENCODE_SUPERMEMORY_LOG = previousLog;
    if (previousApiKey === undefined) delete process.env.SUPERMEMORY_API_KEY;
    else process.env.SUPERMEMORY_API_KEY = previousApiKey;
    cleanupTmpDir(tmpHome);
  });

  it("loads dist/index.js and the captured baseline", async () => {
    const baseline = JSON.parse(readFileSync(join(BASELINE_DIR, "plugin-shape.json"), "utf-8"));
    const mod = await import(join(ROOT, "dist", "index.js"));
    const plugin = await mod.SupermemoryPlugin(makeCtx());
    const defaultKeys = Object.keys(plugin);
    const hookTypes = Object.fromEntries(defaultKeys.map((key) => [key, typeof plugin[key as keyof typeof plugin]]));

    expect(mod).toBeTruthy();
    expect(typeof plugin).toBe(baseline.defaultType);
    expect(defaultKeys).toEqual(baseline.defaultKeys);
    expect(hookTypes).toEqual(baseline.hookTypes);
  });

  it("exposes experimental.session.compacting as a function", async () => {
    const mod = await import(join(ROOT, "dist", "index.js"));
    const plugin = (await mod.SupermemoryPlugin(makeCtx())) as Record<string, unknown>;

    expect(Object.keys(plugin)).toContain("experimental.session.compacting");
    expect(typeof plugin["experimental.session.compacting"]).toBe("function");
  });

  it("returns every hook key even when SUPERMEMORY_API_KEY is unset", async () => {
    // beforeAll deletes SUPERMEMORY_API_KEY — verify the disabled plugin
    // still exposes the full hook surface so OpenCode can call into it
    // without checking shape variants.
    expect(process.env.SUPERMEMORY_API_KEY).toBeUndefined();

    const mod = await import(join(ROOT, "dist", "index.js"));
    const plugin = (await mod.SupermemoryPlugin(makeCtx())) as Record<string, unknown>;
    const keys = Object.keys(plugin);

    expect(keys).toContain("chat.message");
    expect(keys).toContain("tool");
    expect(keys).toContain("event");
    expect(keys).toContain("experimental.session.compacting");
  });

  it("hooks are safe no-ops when apiKey is missing (event + experimental.session.compacting do not throw)", async () => {
    expect(process.env.SUPERMEMORY_API_KEY).toBeUndefined();

    const mod = await import(join(ROOT, "dist", "index.js"));
    const plugin = (await mod.SupermemoryPlugin(makeCtx())) as Record<string, unknown>;

    const eventHook = plugin.event as (input: unknown) => Promise<void>;
    const compactingHook = plugin["experimental.session.compacting"] as (input: unknown, output: unknown) => Promise<void>;

    // Both gated hooks must resolve to undefined (Promise.resolve()) without
    // ever calling the real Supermemory client.
    const eventResult = await eventHook({ event: { type: "session.idle", properties: {} } });
    const compactingResult = await compactingHook({ sessionID: "ses_shape_test" }, []);
    expect(eventResult).toBeUndefined();
    expect(compactingResult).toBeUndefined();
  });
});
