import * as nodeFs from "node:fs";

import { stripJsoncComments } from "./jsonc.js";

/**
 * Narrow filesystem interfaces. These intentionally mirror the slice of
 * node:fs we actually call and are structurally compatible with the in-memory
 * FsLike defined in tests/helpers/mock-fs.ts (which lacks chmodSync — hence
 * the optional / separate interfaces below). Production code receives node:fs
 * by default; tests pass in a mock when they want to assert on call payloads.
 */
export interface FsReadLike {
  readFileSync(path: string, encoding: BufferEncoding): string;
}

export interface FsWriteLike {
  writeFileSync(path: string, data: string, encoding?: BufferEncoding): void;
}

export interface FsMkdirLike {
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

export interface FsChmodLike {
  chmodSync(path: string, mode: number): void;
}

export interface WriteJsonOptions {
  /** JSON.stringify space argument. Defaults to 2 for human-readable output. */
  space?: number | string;
  /** Optional POSIX mode applied via chmodSync after the write completes. */
  mode?: number;
}

/**
 * Reads a JSONC file, strips its comments and trailing commas, and parses it.
 * Throws if the file is missing (ENOENT) or the stripped content is not valid
 * JSON. Cast the return value via the generic parameter when the schema is
 * known.
 */
export function readJsoncFile<T = unknown>(filePath: string, fs: FsReadLike = nodeFs): T {
  const raw = fs.readFileSync(filePath, "utf-8");
  const stripped = stripJsoncComments(raw);
  return JSON.parse(stripped) as T;
}

/**
 * Serializes `data` to JSON (no comments, default 2-space indent) and writes
 * it to `filePath`. When `opts.mode` is provided the file permission bits are
 * adjusted with a follow-up chmodSync — kept separate so the same fs interface
 * works for in-memory mocks that don't model permissions.
 */
export function writeJsoncFile(
  filePath: string,
  data: unknown,
  opts: WriteJsonOptions = {},
  fs: FsWriteLike & Partial<FsChmodLike> = nodeFs,
): void {
  const json = JSON.stringify(data, null, opts.space ?? 2);
  fs.writeFileSync(filePath, json);
  if (opts.mode !== undefined && fs.chmodSync) {
    fs.chmodSync(filePath, opts.mode);
  }
}

/**
 * Reads a plain JSON file (no comment stripping). Throws on missing file or
 * invalid JSON.
 */
export function readJsonFile<T = unknown>(filePath: string, fs: FsReadLike = nodeFs): T {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

/**
 * Writes pretty-printed JSON to `filePath`. Mirrors writeJsoncFile — kept as a
 * distinct entry point so call sites can document intent (strict vs lenient
 * input) and so future divergence (e.g. canonicalization) stays local.
 */
export function writeJsonFile(
  filePath: string,
  data: unknown,
  opts: WriteJsonOptions = {},
  fs: FsWriteLike & Partial<FsChmodLike> = nodeFs,
): void {
  const json = JSON.stringify(data, null, opts.space ?? 2);
  fs.writeFileSync(filePath, json);
  if (opts.mode !== undefined && fs.chmodSync) {
    fs.chmodSync(filePath, opts.mode);
  }
}

/**
 * Creates `dirPath` and any missing parents (mkdir -p). When `mode` is given
 * it is applied to the leaf directory via chmodSync, matching the typical
 * pattern of "make dir, then lock down its permissions". Intermediate parents
 * keep their default mode.
 */
export function ensureDir(dirPath: string, mode?: number, fs: FsMkdirLike & Partial<FsChmodLike> = nodeFs): void {
  fs.mkdirSync(dirPath, { recursive: true });
  if (mode !== undefined && fs.chmodSync) {
    fs.chmodSync(dirPath, mode);
  }
}
