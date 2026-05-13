import { describe, expect, it } from "bun:test";
import { chmod, mkdir, readFile, stat, utimes } from "node:fs/promises";
import { join } from "node:path";

import { appendCaptured, getLastCaptured, pruneOldTrackers } from "@/capture/tracker";
import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir";

async function expectMode(path: string, expectedMode: number): Promise<void> {
  const actualMode = (await stat(path)).mode & 0o777;
  expect(actualMode).toBe(expectedMode);
}

describe("capture tracker", () => {
  it("appends captured message IDs and reads the last non-empty line", async () => {
    const root = createTmpDir("tracker-tail");
    try {
      const trackersDir = join(root, "trackers");

      await appendCaptured("session-a", "msg-1", trackersDir);
      await appendCaptured("session-a", "msg-2", trackersDir);

      expect(await readFile(join(trackersDir, "session-a.txt"), "utf-8")).toBe("msg-1\nmsg-2\n");
      expect(await getLastCaptured("session-a", trackersDir)).toBe("msg-2");
    } finally {
      cleanupTmpDir(root);
    }
  });

  it("sanitizes session IDs before building tracker paths", async () => {
    const root = createTmpDir("tracker-sanitize");
    try {
      const trackersDir = join(root, "trackers");
      const sessionId = "../bad/session:id";

      await appendCaptured(sessionId, "msg-safe", trackersDir);

      expect(await getLastCaptured(sessionId, trackersDir)).toBe("msg-safe");
      expect(await readFile(join(trackersDir, "___bad_session_id.txt"), "utf-8")).toBe("msg-safe\n");
    } finally {
      cleanupTmpDir(root);
    }
  });

  it("prunes old tracker files and keeps new tracker files", async () => {
    const root = createTmpDir("tracker-prune");
    try {
      const trackersDir = join(root, "trackers");
      await mkdir(trackersDir, { recursive: true });
      await appendCaptured("old", "old-msg", trackersDir);
      await appendCaptured("new", "new-msg", trackersDir);

      const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      await utimes(join(trackersDir, "old.txt"), oldTime, oldTime);

      expect(await pruneOldTrackers(trackersDir)).toBe(1);
      expect(await getLastCaptured("old", trackersDir)).toBeNull();
      expect(await getLastCaptured("new", trackersDir)).toBe("new-msg");
    } finally {
      cleanupTmpDir(root);
    }
  });

  it("returns null when the tracker file is missing", async () => {
    const root = createTmpDir("tracker-missing");
    try {
      expect(await getLastCaptured("missing-session", join(root, "trackers"))).toBeNull();
    } finally {
      cleanupTmpDir(root);
    }
  });

  it("creates the tracker directory on first use with owner-only permissions", async () => {
    const root = createTmpDir("tracker-create-dir");
    try {
      const trackersDir = join(root, "nested", "trackers");

      await appendCaptured("session-a", "msg-1", trackersDir);

      await expectMode(trackersDir, 0o700);
    } finally {
      await chmod(root, 0o700);
      cleanupTmpDir(root);
    }
  });
});
