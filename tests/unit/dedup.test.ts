import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDedupCache, withDedup } from "@/memory/dedup";

const tempDirs: string[] = [];

async function makeDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dedup-cache-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("createDedupCache", () => {
  it("reports a hit after adding identical content", async () => {
    const cache = createDedupCache({ dedupEnabled: true, dedupCacheSize: 10, dataDir: await makeDataDir() });

    cache.add("Same memory");

    expect(cache.has("Same memory")).toBe(true);
    expect(await withDedup("Same memory", async () => "stored", cache)).toEqual({ skipped: true });
  });

  it("reports a miss for new content", async () => {
    const cache = createDedupCache({ dedupEnabled: true, dedupCacheSize: 10, dataDir: await makeDataDir() });

    cache.add("Known memory");

    expect(cache.has("Fresh memory")).toBe(false);
  });

  it("normalizes whitespace and case before hashing", async () => {
    const cache = createDedupCache({ dedupEnabled: true, dedupCacheSize: 10, dataDir: await makeDataDir() });

    cache.add("  Alpha\n\tBeta  ");

    expect(cache.has("alpha beta")).toBe(true);
  });

  it("evicts the oldest hash when capacity is reached", async () => {
    const cache = createDedupCache({ dedupEnabled: true, dedupCacheSize: 2, dataDir: await makeDataDir() });

    cache.add("first");
    cache.add("second");
    cache.add("third");

    expect(cache.has("first")).toBe(false);
    expect(cache.has("second")).toBe(true);
    expect(cache.has("third")).toBe(true);
  });

  it("loads persisted hashes after a restart and ignores corrupt cache files", async () => {
    const dataDir = await makeDataDir();
    const cache = createDedupCache({ dedupEnabled: true, dedupCacheSize: 10, dataDir });
    cache.add("persisted memory");
    await cache.flush();

    const restarted = createDedupCache({ dedupEnabled: true, dedupCacheSize: 10, dataDir });
    await restarted.load();

    expect(restarted.has("persisted memory")).toBe(true);

    await writeFile(join(dataDir, "dedup-cache.json"), "{bad json", "utf-8");
    const recovered = createDedupCache({ dedupEnabled: true, dedupCacheSize: 10, dataDir });

    await recovered.load();
    expect(recovered.has("persisted memory")).toBe(false);
  });

  it("flushes valid JSON with only hashes and timestamp", async () => {
    const dataDir = await makeDataDir();
    const cache = createDedupCache({ dedupEnabled: true, dedupCacheSize: 10, dataDir });

    cache.add("private content stays hashed");
    await cache.flush();

    const payload = JSON.parse(await readFile(join(dataDir, "dedup-cache.json"), "utf-8"));

    expect(payload.hashes).toHaveLength(1);
    expect(payload.hashes[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(payload)).not.toContain("private content stays hashed");
  });
});
