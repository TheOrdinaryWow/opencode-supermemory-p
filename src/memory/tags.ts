import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

import { getConfig } from "../config/loader.js";
import type { SupermemoryConfig } from "../config/schema.js";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// In-process cache for the git email lookup. execSync is the expensive part
// and the value never changes during a process lifetime, so we cache both
// the success result and the null fallback (no retry on failure). Tests
// should call resetTagsCache() between cases to avoid cross-test leakage.
let hasCachedGitEmail = false;
let cachedGitEmail: string | null = null;

export function resetTagsCache(): void {
  hasCachedGitEmail = false;
  cachedGitEmail = null;
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
  config: Pick<SupermemoryConfig, "containerTagPrefix" | "projectContainerTag"> = getConfig(),
): string {
  // If projectContainerTag is explicitly set, use it
  if (config.projectContainerTag) {
    return config.projectContainerTag;
  }

  // Otherwise, auto-generate based on containerTagPrefix
  return `${config.containerTagPrefix}_project_${sha256(directory)}`;
}

export function getTags(directory: string): { user: string; project: string } {
  const config = getConfig();
  return {
    user: getUserTag(config),
    project: getProjectTag(directory, config),
  };
}
