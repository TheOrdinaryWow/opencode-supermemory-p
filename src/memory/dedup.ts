import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface DedupCacheConfig {
  dedupEnabled: boolean;
  dedupCacheSize: number;
  dataDir: string;
}

interface PersistedDedupCache {
  hashes: string[];
  updatedAt: string;
}

export interface DedupCache {
  has(content: string): boolean;
  add(content: string): void;
  flush(): Promise<void>;
  load(): Promise<void>;
}

const CACHE_FILE = "dedup-cache.json";

function normalizeContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

function hashContent(content: string): string {
  return createHash("sha256").update(normalizeContent(content)).digest("hex");
}

function parsePersistedCache(raw: string): string[] {
  const parsed = JSON.parse(raw) as Partial<PersistedDedupCache>;

  if (!Array.isArray(parsed.hashes)) {
    return [];
  }

  return parsed.hashes.filter((hash): hash is string => typeof hash === "string");
}

function trimToCapacity(hashes: string[], capacity: number): string[] {
  if (capacity <= 0) {
    return [];
  }

  return hashes.slice(-capacity);
}

export function createDedupCache(config: DedupCacheConfig): DedupCache {
  const cachePath = join(config.dataDir, CACHE_FILE);
  const hashes = new Set<string>();
  let loaded = false;

  function replaceHashes(nextHashes: string[]): void {
    hashes.clear();
    for (const hash of trimToCapacity(nextHashes, config.dedupCacheSize)) {
      hashes.add(hash);
    }
  }

  function loadSync(): void {
    if (loaded || !config.dedupEnabled) {
      loaded = true;
      return;
    }

    try {
      if (!existsSync(cachePath)) {
        replaceHashes([]);
        return;
      }

      replaceHashes(parsePersistedCache(readFileSync(cachePath, "utf-8")));
    } catch {
      replaceHashes([]);
    } finally {
      loaded = true;
    }
  }

  return {
    has(content: string): boolean {
      loadSync();

      if (!config.dedupEnabled) {
        return false;
      }

      const hash = hashContent(content);
      if (!hashes.has(hash)) {
        return false;
      }

      hashes.delete(hash);
      hashes.add(hash);
      return true;
    },

    add(content: string): void {
      if (!config.dedupEnabled || config.dedupCacheSize <= 0) {
        return;
      }

      loadSync();

      const hash = hashContent(content);
      if (hashes.has(hash)) {
        hashes.delete(hash);
      } else if (hashes.size >= config.dedupCacheSize) {
        const oldestHash = hashes.values().next().value;
        if (oldestHash) {
          hashes.delete(oldestHash);
        }
      }

      hashes.add(hash);
    },

    async flush(): Promise<void> {
      if (!config.dedupEnabled) {
        return;
      }

      await fs.mkdir(config.dataDir, { recursive: true, mode: 0o700 });

      const payload: PersistedDedupCache = {
        hashes: [...hashes],
        updatedAt: new Date().toISOString(),
      };
      const json = JSON.stringify(payload, null, 2);
      const tmpPath = `${cachePath}.tmp.${process.pid}`;

      await fs.writeFile(tmpPath, json, { mode: 0o600 });
      await fs.rename(tmpPath, cachePath);
    },

    async load(): Promise<void> {
      if (!config.dedupEnabled) {
        loaded = true;
        replaceHashes([]);
        return;
      }

      try {
        const raw = await fs.readFile(cachePath, "utf-8");
        replaceHashes(parsePersistedCache(raw));
      } catch {
        replaceHashes([]);
      } finally {
        loaded = true;
      }
    },
  };
}

export async function withDedup<T>(
  content: string,
  fn: () => Promise<T>,
  cache: ReturnType<typeof createDedupCache>,
): Promise<T | { skipped: true }> {
  if (cache.has(content)) {
    return { skipped: true };
  }

  const result = await fn();
  cache.add(content);
  return result;
}
