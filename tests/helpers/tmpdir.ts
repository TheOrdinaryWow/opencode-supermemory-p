import { afterAll } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";

/**
 * Creates an isolated, empty temporary directory under the OS temp root.
 *
 * Caller is responsible for invoking {@link cleanupTmpDir} (or using
 * {@link useTmpDir}, which registers cleanup automatically).
 *
 * The directory name is prefixed with `omsm-` and the (sanitized) label,
 * making it easy to spot leftovers in `/tmp` if a test bypasses cleanup.
 */
export function createTmpDir(label = "test"): string {
  const safe = label.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32) || "test";
  return mkdtempSync(join(osTmpdir(), `omsm-${safe}-`));
}

/**
 * Recursively removes a directory tree. Safe to call repeatedly and on
 * already-removed paths — never throws on missing directories.
 */
export function cleanupTmpDir(dir: string): void {
  if (!dir || !existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Convenience: create a tmp dir scoped to the surrounding `describe` block
 * and register `afterAll` cleanup.
 *
 * MUST be called at `describe`-level (or test-file top-level) — calling
 * it from `beforeEach` would register one `afterAll` per test, which is
 * wasteful even if not incorrect.
 */
export function useTmpDir(label = "test"): string {
  const dir = createTmpDir(label);
  afterAll(() => cleanupTmpDir(dir));
  return dir;
}
