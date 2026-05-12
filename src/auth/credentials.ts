import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ensureDir, writeJsonFile } from "../shared/fs-utils.js";

export const CREDENTIALS_DIR = join(homedir(), ".supermemory-opencode");
export const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

export interface Credentials {
  apiKey: string;
  createdAt: string;
}

export function loadCredentials(): Credentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const content = readFileSync(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(content) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(apiKey: string): void {
  ensureDir(CREDENTIALS_DIR, 0o700);
  const credentials: Credentials = {
    apiKey,
    createdAt: new Date().toISOString(),
  };
  writeJsonFile(CREDENTIALS_FILE, credentials, { mode: 0o600 });
}

export function clearCredentials(): boolean {
  if (!existsSync(CREDENTIALS_FILE)) return false;
  rmSync(CREDENTIALS_FILE);
  return true;
}
