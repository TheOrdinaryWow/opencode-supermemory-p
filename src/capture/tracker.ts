import { appendFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function trackerPath(sessionId: string, trackersDir: string): string {
  const sanitizedSessionId = sessionId.replace(/[^a-z0-9_-]/gi, "_");
  return join(trackersDir, `${sanitizedSessionId}.txt`);
}

async function ensureTrackersDir(trackersDir: string): Promise<void> {
  await mkdir(trackersDir, { recursive: true, mode: 0o700 });
}

export async function getLastCaptured(sessionId: string, trackersDir: string): Promise<string | null> {
  try {
    const content = await readFile(trackerPath(sessionId, trackersDir), "utf-8");
    const capturedIds = content.split(/\r?\n/).filter((line) => line.length > 0);
    return capturedIds.at(-1) ?? null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function appendCaptured(sessionId: string, messageId: string, trackersDir: string): Promise<void> {
  await ensureTrackersDir(trackersDir);
  await appendFile(trackerPath(sessionId, trackersDir), `${messageId}\n`, "utf-8");
}

export async function pruneOldTrackers(trackersDir: string, maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<number> {
  await ensureTrackersDir(trackersDir);
  const entries = await readdir(trackersDir, { withFileTypes: true });
  const cutoff = Date.now() - maxAgeMs;
  let deletedCount = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const filePath = join(trackersDir, entry.name);
    const fileStat = await stat(filePath);
    if (fileStat.mtimeMs >= cutoff) continue;

    await rm(filePath);
    deletedCount += 1;
  }

  return deletedCount;
}
