import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BASELINE_DIR = join(ROOT, "tests", "fixtures", "baseline");

describe("plugin shape baseline", () => {
  it("loads dist/index.js and the captured baseline", async () => {
    const baseline = JSON.parse(readFileSync(join(BASELINE_DIR, "plugin-shape.json"), "utf-8"));
    const mod = await import(join(ROOT, "dist", "index.js"));

    expect(mod).toBeTruthy();
    expect(baseline.defaultKeys).toBeTruthy();
    expect(baseline.defaultType).toBeTruthy();
    expect(baseline.hookTypes).toBeTruthy();
  });
});
