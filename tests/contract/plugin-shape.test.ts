import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir";

const ROOT = process.cwd();
const BASELINE_DIR = join(ROOT, "tests", "fixtures", "baseline");

describe("plugin shape baseline", () => {
  let tmpHome: string;
  let previousLog: string | undefined;

  beforeAll(() => {
    // Bun's os.homedir() ignores process.env.HOME, so route the plugin log
    // explicitly into a tmp dir via the env override the logger honours.
    tmpHome = createTmpDir("plugin-shape-home");
    previousLog = process.env.OPENCODE_SUPERMEMORY_LOG;
    process.env.OPENCODE_SUPERMEMORY_LOG = join(tmpHome, "log", "main.log");
  });

  afterAll(() => {
    if (previousLog === undefined) delete process.env.OPENCODE_SUPERMEMORY_LOG;
    else process.env.OPENCODE_SUPERMEMORY_LOG = previousLog;
    cleanupTmpDir(tmpHome);
  });

  it("loads dist/index.js and the captured baseline", async () => {
    const baseline = JSON.parse(readFileSync(join(BASELINE_DIR, "plugin-shape.json"), "utf-8"));
    const mod = await import(join(ROOT, "dist", "index.js"));
    const plugin = await mod.SupermemoryPlugin({
      directory: "/tmp/test",
      client: {
        provider: {
          list: async () => ({ data: { all: [] } }),
        },
      },
    } as never);
    const defaultKeys = Object.keys(plugin);
    const hookTypes = Object.fromEntries(defaultKeys.map((key) => [key, typeof plugin[key as keyof typeof plugin]]));

    expect(mod).toBeTruthy();
    expect(typeof plugin).toBe(baseline.defaultType);
    expect(defaultKeys).toEqual(baseline.defaultKeys);
    expect(hookTypes).toEqual(baseline.hookTypes);
  });
});
