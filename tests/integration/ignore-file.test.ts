import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { installMockFetch, uninstallMockFetch } from "../helpers/mock-fetch";
import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const DIST_INDEX = pathToFileURL(join(REPO_ROOT, "dist", "index.js")).href;

interface ToastCall {
  body: { title: string; message: string; variant: string; duration: number };
}

interface MockCtx {
  directory: string;
  client: {
    provider: { list: () => Promise<{ data: { all: never[] } }> };
    tui: { showToast: (params: ToastCall) => Promise<{ ok: true }> };
  };
  toasts: ToastCall[];
}

function createCtx(directory: string): MockCtx {
  const toasts: ToastCall[] = [];
  return {
    directory,
    toasts,
    client: {
      provider: {
        list: async () => ({ data: { all: [] } }),
      },
      tui: {
        showToast: async (params: ToastCall) => {
          toasts.push(params);
          return { ok: true };
        },
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

  it("shows a disabled-by-ignore toast on the first event after init", async () => {
    writeFileSync(join(projectDir, ".supermemoryignore"), "");

    // package.json is the source of truth for the version baked into the toast title.
    const pkg = JSON.parse((await import("node:fs")).readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { version: string };

    const mod = await importFreshPlugin("toast");
    const ctx = createCtx(projectDir);
    const plugin = (await mod.SupermemoryPlugin(ctx)) as Record<string, unknown>;
    const eventHook = plugin.event as (input: unknown) => Promise<void>;

    await eventHook({ event: { type: "session.idle", properties: {} } });

    expect(ctx.toasts).toHaveLength(1);
    expect(ctx.toasts[0]).toBeDefined();
    const toast = ctx.toasts[0] as ToastCall;
    expect(toast.body.title).toBe(`opencode-supermemory-p ${pkg.version}`);
    expect(toast.body.message).toBe("Supermemory is disabled because .supermemoryignore file is present in the project.");
  });

  it("shows the ignore toast only once across multiple events", async () => {
    writeFileSync(join(projectDir, ".supermemoryignore"), "");

    const mod = await importFreshPlugin("toast-once");
    const ctx = createCtx(projectDir);
    const plugin = (await mod.SupermemoryPlugin(ctx)) as Record<string, unknown>;
    const eventHook = plugin.event as (input: unknown) => Promise<void>;

    await eventHook({ event: { type: "session.idle", properties: {} } });
    await eventHook({ event: { type: "session.updated", properties: { sessionID: "ses_x" } } });
    await eventHook({ event: { type: "session.idle", properties: {} } });

    expect(ctx.toasts).toHaveLength(1);
  });

  it("does NOT show the ignore toast when .supermemoryignore is absent", async () => {
    delete process.env.SUPERMEMORY_API_KEY;

    const mod = await importFreshPlugin("no-toast");
    const ctx = createCtx(projectDir);
    const plugin = (await mod.SupermemoryPlugin(ctx)) as Record<string, unknown>;
    const eventHook = plugin.event as (input: unknown) => Promise<void>;

    await eventHook({ event: { type: "session.idle", properties: {} } });

    expect(ctx.toasts).toHaveLength(0);
  });
});
