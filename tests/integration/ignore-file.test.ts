import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { installMockFetch, uninstallMockFetch } from "../helpers/mock-fetch";
import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const DIST_INDEX = pathToFileURL(join(REPO_ROOT, "dist", "index.js")).href;

interface MockCtx {
  directory: string;
  client: {
    provider: { list: () => Promise<{ data: { all: never[] } }> };
  };
}

function createCtx(directory: string): MockCtx {
  return {
    directory,
    client: {
      provider: {
        list: async () => ({ data: { all: [] } }),
      },
    },
  };
}

async function importFreshPlugin(label: string) {
  return import(`${DIST_INDEX}?ignore=${label}-${Date.now()}-${Math.random()}`);
}

describe("plugin disables itself when .supermemoryignore is present", () => {
  let home: string;
  let previousHome: string | undefined;
  let previousLog: string | undefined;
  let previousApiKey: string | undefined;

  beforeAll(() => {
    home = createTmpDir("ignore-home");
    previousHome = process.env.HOME;
    previousLog = process.env.OPENCODE_SUPERMEMORY_LOG;
    previousApiKey = process.env.SUPERMEMORY_API_KEY;
    process.env.HOME = home;
    process.env.OPENCODE_SUPERMEMORY_LOG = join(home, ".local", "share", "opencode-supermemory-p", "log", "main.log");
    // Block every outbound HTTP call — guarantees the test never hits the real Supermemory API.
    installMockFetch();
  });

  afterAll(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousLog === undefined) delete process.env.OPENCODE_SUPERMEMORY_LOG;
    else process.env.OPENCODE_SUPERMEMORY_LOG = previousLog;
    if (previousApiKey === undefined) delete process.env.SUPERMEMORY_API_KEY;
    else process.env.SUPERMEMORY_API_KEY = previousApiKey;
    cleanupTmpDir(home);
    uninstallMockFetch();
  });

  let projectDir: string;

  beforeEach(() => {
    projectDir = createTmpDir("ignore-project");
    // Make sure the API key looks configured so the only thing disabling the plugin is the ignore file.
    process.env.SUPERMEMORY_API_KEY = "sm_test_ignore_0001";
  });

  afterEach(() => {
    cleanupTmpDir(projectDir);
    delete process.env.SUPERMEMORY_API_KEY;
  });

  it("still exposes the full hook surface (matches the unconfigured plugin shape)", async () => {
    writeFileSync(join(projectDir, ".supermemoryignore"), "");

    const mod = await importFreshPlugin("shape");
    const plugin = (await mod.SupermemoryPlugin(createCtx(projectDir))) as Record<string, unknown>;

    expect(Object.keys(plugin).sort()).toEqual(["chat.message", "event", "experimental.session.compacting", "tool"].sort());
    expect(typeof plugin["chat.message"]).toBe("function");
    expect(typeof plugin.event).toBe("function");
    expect(typeof plugin["experimental.session.compacting"]).toBe("function");
    expect(typeof plugin.tool).toBe("object");
  });

  it("event hook is a safe no-op when .supermemoryignore is present", async () => {
    writeFileSync(join(projectDir, ".supermemoryignore"), "");

    const mod = await importFreshPlugin("event");
    const plugin = (await mod.SupermemoryPlugin(createCtx(projectDir))) as Record<string, unknown>;
    const eventHook = plugin.event as (input: unknown) => Promise<void>;

    const result = await eventHook({ event: { type: "session.idle", properties: {} } });
    expect(result).toBeUndefined();
  });

  it("experimental.session.compacting is a safe no-op when .supermemoryignore is present", async () => {
    writeFileSync(join(projectDir, ".supermemoryignore"), "");

    const mod = await importFreshPlugin("compacting");
    const plugin = (await mod.SupermemoryPlugin(createCtx(projectDir))) as Record<string, unknown>;
    const compactingHook = plugin["experimental.session.compacting"] as (input: unknown, output: unknown) => Promise<void>;

    const result = await compactingHook({ sessionID: "ses_ignored" }, []);
    expect(result).toBeUndefined();
  });

  it("chat.message hook leaves output.parts untouched when .supermemoryignore is present", async () => {
    writeFileSync(join(projectDir, ".supermemoryignore"), "");

    const mod = await importFreshPlugin("chat");
    const plugin = (await mod.SupermemoryPlugin(createCtx(projectDir))) as Record<string, unknown>;
    const chatHook = plugin["chat.message"] as (input: unknown, output: { message: { id: string }; parts: unknown[] }) => Promise<void>;

    const output = { message: { id: "msg_1" }, parts: [{ type: "text", text: "hello" }] };
    await chatHook({ sessionID: "ses_ignored" }, output);

    // Plugin must not append context, even though apiKey is configured —
    // the ignore file disables every memory injection path.
    expect(output.parts).toHaveLength(1);
  });

  it("plugin behaves normally (still no-op without apiKey, but factory runs) when ignore file is absent", async () => {
    // Sanity counter-example: in the SAME tmp project without the ignore file,
    // the plugin should still construct successfully and return the full hook surface.
    delete process.env.SUPERMEMORY_API_KEY;

    const mod = await importFreshPlugin("absent");
    const plugin = (await mod.SupermemoryPlugin(createCtx(projectDir))) as Record<string, unknown>;

    expect(Object.keys(plugin).sort()).toEqual(["chat.message", "event", "experimental.session.compacting", "tool"].sort());
  });
});
