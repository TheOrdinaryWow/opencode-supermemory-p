import { describe, expect, it } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const DIST_INDEX = pathToFileURL(join(REPO_ROOT, "dist", "index.js")).href;

function createCtx() {
  return {
    directory: "/tmp/test",
    client: {
      provider: {
        list: async () => ({ data: { all: [] } }),
      },
    },
  } as never;
}

async function withIsolatedHome<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const home = createTmpDir(label);
  const previousHome = process.env.HOME;
  const previousLog = process.env.OPENCODE_SUPERMEMORY_LOG;
  const previousApiKey = process.env.SUPERMEMORY_API_KEY;
  try {
    process.env.HOME = home;
    // Bun's os.homedir() ignores process.env.HOME, so force the log path
    // explicitly to keep tests from writing to the real $HOME.
    process.env.OPENCODE_SUPERMEMORY_LOG = join(home, ".local", "share", "opencode-supermemory-p", "log", "main.log");
    delete process.env.SUPERMEMORY_API_KEY;
    return await fn();
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousLog === undefined) delete process.env.OPENCODE_SUPERMEMORY_LOG;
    else process.env.OPENCODE_SUPERMEMORY_LOG = previousLog;
    if (previousApiKey === undefined) delete process.env.SUPERMEMORY_API_KEY;
    else process.env.SUPERMEMORY_API_KEY = previousApiKey;
    cleanupTmpDir(home);
  }
}

async function importFreshPlugin(label: string) {
  return import(`${DIST_INDEX}?smoke=${label}-${Date.now()}-${Math.random()}`);
}

describe("plugin smoke", () => {
  it("loads dist/index.js and exposes the plugin factory", async () => {
    await withIsolatedHome("plugin-load", async () => {
      const mod = await importFreshPlugin("load");

      expect(mod).toBeTruthy();
      expect(typeof mod.SupermemoryPlugin).toBe("function");
      const plugin = await mod.SupermemoryPlugin(createCtx());
      expect(plugin).toBeTruthy();
      expect(typeof plugin).toBe("object");
    });
  });

  it("runs the chat.message hook without throwing", async () => {
    await withIsolatedHome("plugin-chat", async () => {
      const mod = await importFreshPlugin("chat");
      const plugin = await mod.SupermemoryPlugin(createCtx());
      const output = { message: { id: "msg_1" }, parts: [] };

      const result = await plugin["chat.message"]({ sessionID: "ses_1" }, output);

      expect(result).toBeUndefined();
      expect(output.parts).toHaveLength(0);
    });
  });

  it("runs the event hook without throwing", async () => {
    await withIsolatedHome("plugin-event", async () => {
      const mod = await importFreshPlugin("event");
      const plugin = await mod.SupermemoryPlugin(createCtx());

      const result = await plugin.event({ event: { type: "session.updated", properties: { sessionID: "ses_1" } } });

      expect(result).toBeUndefined();
    });
  });
});
