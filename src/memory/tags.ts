import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

import { getConfig } from "@/config/loader";
import type { SupermemoryConfig } from "@/config/schema";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// In-process cache for the git email lookup. execSync is the expensive part
// and the value never changes during a process lifetime, so we cache both
// the success result and the null fallback (no retry on failure). Tests
// should call resetTagsCache() between cases to avoid cross-test leakage.
let hasCachedGitEmail = false;
let cachedGitEmail: string | null = null;

// Cache git remote URL per directory. Different worktrees can have different
// remotes, so we key by directory rather than caching a single global value.
const gitRepoNameCache = new Map<string, string | null>();

export function resetTagsCache(): void {
  hasCachedGitEmail = false;
  cachedGitEmail = null;
  gitRepoNameCache.clear();
}

export function getGitEmail(): string | null {
  if (hasCachedGitEmail) return cachedGitEmail;
  try {
    const email = execSync("git config user.email", { encoding: "utf-8" }).trim();
    cachedGitEmail = email || null;
  } catch {
    cachedGitEmail = null;
  }
  hasCachedGitEmail = true;
  return cachedGitEmail;
}

/**
 * Parses `owner/repo` out of a git remote URL.
 *
 * Supports:
 *   - HTTPS: `https://github.com/owner/repo(.git)?`
 *   - SSH (URL form): `ssh://git@host[:port]/owner/repo(.git)?`
 *   - SSH (SCP-like): `git@github.com:owner/repo(.git)?`
 *   - git protocol:  `git://host/owner/repo(.git)?`
 *
 * Returns null when the URL has no `owner/repo` segment.
 */
export function parseGitRepoName(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Try URL form first (covers https/http/ssh://, git://). Requires a
  // non-empty host so degenerate inputs like "foo:bar/baz" (parses as a URL
  // with an empty host) don't sneak through.
  try {
    const u = new URL(trimmed);
    if (u.host) {
      const path = u.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
      if (path.includes("/")) return path;
      return null;
    }
  } catch {
    // Not a URL — fall through to the SCP-like SSH form below.
  }

  // SCP-like SSH form: user@host:path (no scheme separator before the colon).
  // Distinct from URL form, which requires `scheme://`.
  const sshMatch = trimmed.match(/^[^\s@]+@[^\s:]+:([^\s]+)$/);
  if (sshMatch) {
    const captured = sshMatch[1] ?? "";
    const path = captured.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    if (path.includes("/")) return path;
  }

  return null;
}

/**
 * Returns the `owner/repo` segment of the current directory's git remote, or
 * null if `directory` is not inside a git repo, has no `origin` remote, or
 * the URL cannot be parsed into an `owner/repo` shape. Results are cached
 * per-directory for the lifetime of the process.
 */
export function getGitRepoName(directory: string): string | null {
  if (gitRepoNameCache.has(directory)) {
    return gitRepoNameCache.get(directory) ?? null;
  }
  let result: string | null = null;
  try {
    const url = execSync("git config --get remote.origin.url", {
      encoding: "utf-8",
      cwd: directory,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (url) result = parseGitRepoName(url);
  } catch {
    result = null;
  }
  gitRepoNameCache.set(directory, result);
  return result;
}

export function getUserTag(config: Pick<SupermemoryConfig, "containerTagPrefix" | "userContainerTag"> = getConfig()): string {
  // If userContainerTag is explicitly set, use it
  if (config.userContainerTag) {
    return config.userContainerTag;
  }

  // Otherwise, auto-generate based on containerTagPrefix
  const email = getGitEmail();
  if (email) {
    return `${config.containerTagPrefix}_user_${sha256(email)}`;
  }
  const fallback = process.env.USER || process.env.USERNAME || "anonymous";
  return `${config.containerTagPrefix}_user_${sha256(fallback)}`;
}

export function getProjectTag(
  directory: string,
  config: Pick<SupermemoryConfig, "containerTagPrefix" | "projectContainerTag" | "projectTagStrategy"> = getConfig(),
): string {
  // If projectContainerTag is explicitly set, use it verbatim.
  if (config.projectContainerTag) {
    return config.projectContainerTag;
  }

  const prefix = config.containerTagPrefix;
  const strategy = config.projectTagStrategy;

  // Git-backed strategies: try to resolve the repo name first, fall back to
  // hashDirectory when not in a git repo or no `origin` remote.
  if (strategy === "hashGitRepoName" || strategy === "RawGitRepoName") {
    const repoName = getGitRepoName(directory);
    if (repoName) {
      if (strategy === "hashGitRepoName") {
        return `${prefix}_project_${sha256(repoName)}`;
      }
      // RawGitRepoName: "owner/repo" -> "owner_repo" (avoid "/" in tags)
      const safe = repoName.replace(/\//g, "_");
      return `${prefix}_project_${safe}`;
    }
  }

  // Default / fallback: hash the absolute directory path.
  return `${prefix}_project_${sha256(directory)}`;
}

export function getTags(directory: string): { user: string; project: string } {
  const config = getConfig();
  return {
    user: getUserTag(config),
    project: getProjectTag(directory, config),
  };
}
