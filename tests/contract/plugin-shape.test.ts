import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BASELINE_DIR = join(ROOT, "tests", "fixtures", "baseline");

describe("plugin shape baseline", () => {
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
