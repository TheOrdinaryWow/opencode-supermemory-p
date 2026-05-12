import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

import { CONFIG } from "../config.js";

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

export function getUserTag(): string {
  // If userContainerTag is explicitly set, use it
  if (CONFIG.userContainerTag) {
    return CONFIG.userContainerTag;
  }

  // Otherwise, auto-generate based on containerTagPrefix
  const email = getGitEmail();
  if (email) {
    return `${CONFIG.containerTagPrefix}_user_${sha256(email)}`;
  }
  const fallback = process.env.USER || process.env.USERNAME || "anonymous";
  return `${CONFIG.containerTagPrefix}_user_${sha256(fallback)}`;
}

export function getProjectTag(directory: string): string {
  // If projectContainerTag is explicitly set, use it
  if (CONFIG.projectContainerTag) {
    return CONFIG.projectContainerTag;
  }

  // Otherwise, auto-generate based on containerTagPrefix
  return `${CONFIG.containerTagPrefix}_project_${sha256(directory)}`;
}

export function getTags(directory: string): { user: string; project: string } {
  return {
    user: getUserTag(),
    project: getProjectTag(directory),
  };
}
