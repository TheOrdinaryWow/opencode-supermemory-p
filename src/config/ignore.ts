import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Filename that, when present at the project root, disables the entire
 * plugin for that project. Mirrors the well-known `.gitignore`/`.dockerignore`
 * convention — presence of the file is the signal; its content is ignored.
 */
export const SUPERMEMORY_IGNORE_FILENAME = ".supermemoryignore";

/**
 * Returns `true` when the given project directory contains a
 * `.supermemoryignore` file at its root, signalling that the plugin must
 * not capture or recall any memory for this project.
 *
 * The check is intentionally presence-only — the file's content is not
 * parsed. An empty `.supermemoryignore` is sufficient to disable the
 * plugin, matching the spirit of `.gitignore` marker files.
 *
 * Safe to call with a non-existent path or an empty string; both return
 * `false` without throwing.
 */
export function isProjectIgnored(directory: string): boolean {
  if (!directory) return false;
  return existsSync(join(directory, SUPERMEMORY_IGNORE_FILENAME));
}
