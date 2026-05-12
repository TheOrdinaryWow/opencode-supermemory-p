/**
 * Minimal filesystem interface used by interface-injected production code.
 *
 * The shape is intentionally narrow: only the methods we actually need to
 * mock for refactor-target call sites. Add methods here as new call sites
 * surface — do NOT mirror all of `node:fs`.
 */
export interface FsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: BufferEncoding): string;
  writeFileSync(path: string, data: string, encoding?: BufferEncoding): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  readdirSync(path: string): string[];
}

/**
 * Like {@link FsLike} but also exposes the underlying file map for
 * assertions and seeding.
 */
export interface MockFs extends FsLike {
  /** Snapshot of the in-memory file system (path -> content). */
  dump(): Record<string, string>;
  /** Replace the entire file map (useful between tests). */
  reset(initial?: Record<string, string>): void;
}

class EnoentError extends Error {
  readonly code = "ENOENT";
  constructor(path: string) {
    super(`ENOENT: no such file or directory, open '${path}'`);
    this.name = "Error";
  }
}

/**
 * Builds an in-memory mock filesystem. Designed for **dependency
 * injection** — production code receives an `FsLike` and the test passes
 * this mock. This deliberately does NOT monkey-patch `node:fs`.
 *
 * Behaviour:
 * - `existsSync` checks the map and treats any path with files beneath
 *   it as an existing directory.
 * - `readFileSync` throws ENOENT for unknown paths (matches real fs).
 * - `writeFileSync` records the content; the `encoding` arg is accepted
 *   for API compatibility but ignored (content is always stored as utf-8).
 * - `mkdirSync` is a no-op (in-memory paths are implicit).
 * - `rmSync` deletes the exact key and, when `recursive` is true, all
 *   keys under `path + "/"`.
 * - `readdirSync` returns immediate children — synthesized from the
 *   recorded file paths.
 */
export function createMockFs(initial: Record<string, string> = {}): MockFs {
  let files = new Map<string, string>(Object.entries(initial));

  const isDir = (p: string): boolean => {
    const prefix = p.endsWith("/") ? p : `${p}/`;
    for (const key of files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  };

  return {
    existsSync(path) {
      return files.has(path) || isDir(path);
    },
    readFileSync(path, _encoding) {
      const content = files.get(path);
      if (content === undefined) throw new EnoentError(path);
      return content;
    },
    writeFileSync(path, data, _encoding) {
      files.set(path, data);
    },
    mkdirSync(_path, _options) {
      // no-op: directories are implicit in this in-memory model
    },
    rmSync(path, options) {
      files.delete(path);
      if (options?.recursive) {
        const prefix = path.endsWith("/") ? path : `${path}/`;
        for (const key of Array.from(files.keys())) {
          if (key.startsWith(prefix)) files.delete(key);
        }
      }
    },
    readdirSync(path) {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const direct = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const head = rest.split("/")[0];
        if (head) direct.add(head);
      }
      return Array.from(direct).sort();
    },
    dump() {
      return Object.fromEntries(files);
    },
    reset(seed = {}) {
      files = new Map<string, string>(Object.entries(seed));
    },
  };
}
