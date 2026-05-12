import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createMockExec } from "./mock-exec";
import { installMockFetch, listMockFetchMatchers, mockFetch, resetMockFetch, uninstallMockFetch } from "./mock-fetch";
import { createMockFs } from "./mock-fs";
import { advanceTime, resetTime, setFakeTime, useFakeTimers, useRealTimers } from "./mock-time";
import { cleanupTmpDir, createTmpDir, useTmpDir } from "./tmpdir";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const GIT_SETUP = resolve(REPO_ROOT, "tests", "fixtures", "git", "setup.sh");

// =====================================================================
// tmpdir
// =====================================================================

describe("tmpdir helper", () => {
  it("creates unique directories", () => {
    const a = createTmpDir("alpha");
    const b = createTmpDir("alpha");
    try {
      expect(a).not.toBe(b);
      expect(existsSync(a)).toBe(true);
      expect(existsSync(b)).toBe(true);
    } finally {
      cleanupTmpDir(a);
      cleanupTmpDir(b);
    }
  });

  it("supports writing then reading files inside", () => {
    const dir = createTmpDir("rw");
    try {
      writeFileSync(join(dir, "x.txt"), "hello");
      expect(readFileSync(join(dir, "x.txt"), "utf-8")).toBe("hello");
    } finally {
      cleanupTmpDir(dir);
    }
  });

  it("cleanupTmpDir is idempotent and silent on missing dirs", () => {
    const dir = createTmpDir("idem");
    cleanupTmpDir(dir);
    expect(existsSync(dir)).toBe(false);
    // second call must not throw
    cleanupTmpDir(dir);
    cleanupTmpDir("/tmp/this-dir-was-never-created-by-us-42");
  });

  describe("useTmpDir auto-cleanup", () => {
    const dir = useTmpDir("auto");
    let capturedDir = "";

    it("dir exists during the test", () => {
      capturedDir = dir;
      writeFileSync(join(dir, "marker.txt"), "alive");
      expect(existsSync(join(dir, "marker.txt"))).toBe(true);
    });

    afterAll(() => {
      // After useTmpDir's own afterAll has fired (registration order:
      // useTmpDir's cleanup runs first because it was registered first),
      // the directory must be gone.
      expect(existsSync(capturedDir)).toBe(false);
    });
  });
});

// =====================================================================
// mock-fs
// =====================================================================

describe("mock-fs helper", () => {
  it("seeds files and reports existence", () => {
    const fs = createMockFs({
      "/etc/conf.json": '{"k":"v"}',
      "/etc/sub/inner.txt": "inner",
    });
    expect(fs.existsSync("/etc/conf.json")).toBe(true);
    expect(fs.existsSync("/etc")).toBe(true); // directory inferred
    expect(fs.existsSync("/etc/missing")).toBe(false);
  });

  it("readFileSync throws ENOENT for unknown paths", () => {
    const fs = createMockFs();
    try {
      fs.readFileSync("/nope", "utf-8");
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as Error & { code?: string };
      expect(e.code).toBe("ENOENT");
      expect(e.message).toContain("/nope");
    }
  });

  it("write/readdir/rm round-trips", () => {
    const fs = createMockFs();
    fs.writeFileSync("/dir/a.txt", "A");
    fs.writeFileSync("/dir/b.txt", "B");
    fs.writeFileSync("/dir/sub/c.txt", "C");
    expect(fs.readdirSync("/dir").sort()).toEqual(["a.txt", "b.txt", "sub"]);
    fs.rmSync("/dir/a.txt");
    expect(fs.existsSync("/dir/a.txt")).toBe(false);
    fs.rmSync("/dir", { recursive: true });
    expect(fs.existsSync("/dir/b.txt")).toBe(false);
    expect(fs.existsSync("/dir/sub/c.txt")).toBe(false);
  });

  it("dump/reset round-trip", () => {
    const fs = createMockFs({ "/a": "1" });
    fs.writeFileSync("/b", "2");
    expect(fs.dump()).toEqual({ "/a": "1", "/b": "2" });
    fs.reset({ "/c": "3" });
    expect(fs.dump()).toEqual({ "/c": "3" });
  });
});

// =====================================================================
// mock-fetch (strict mode)
// =====================================================================

describe("mock-fetch helper (strict)", () => {
  beforeAll(() => installMockFetch());
  afterAll(() => uninstallMockFetch());
  beforeEach(() => resetMockFetch());

  it("throws containing 'unmocked URL' on unregistered URLs", async () => {
    try {
      await fetch("https://nope.example.com/");
      throw new Error("expected fetch to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/unmocked URL: https:\/\/nope\.example\.com\//);
    }
  });

  it("returns a registered static Response", async () => {
    mockFetch("https://api.example.com/x", new Response("ok-static"));
    const res = await fetch("https://api.example.com/x");
    expect(await res.text()).toBe("ok-static");
  });

  it("invokes a function responder with the URL", async () => {
    mockFetch(/\/echo\?msg=/, ({ url }) => {
      const u = new URL(url);
      return new Response(u.searchParams.get("msg") ?? "");
    });
    const res = await fetch("https://api.example.com/echo?msg=pong");
    expect(await res.text()).toBe("pong");
  });

  it("tracks registered matchers for assertions", () => {
    mockFetch("https://a/", new Response("a"));
    mockFetch(/foo/, new Response("b"));
    const list = listMockFetchMatchers();
    expect(list.length).toBe(2);
    expect(list[0]).toBe("https://a/");
    expect((list[1] as RegExp).source).toBe("foo");
  });

  it("static Response can be consumed across multiple matches (cloned)", async () => {
    mockFetch("/reuse", new Response("same"));
    const a = await fetch("https://x/reuse");
    const b = await fetch("https://x/reuse");
    expect(await a.text()).toBe("same");
    expect(await b.text()).toBe("same");
  });
});

// =====================================================================
// mock-exec
// =====================================================================

describe("mock-exec helper", () => {
  it("returns registered output for a prefix match", () => {
    const exec = createMockExec();
    exec.register("git config user.email", "test@example.com\n");
    expect(exec.exec("git config user.email")).toBe("test@example.com\n");
  });

  it("matches prefixes (not exact strings)", () => {
    const exec = createMockExec();
    exec.register("git rev-parse", "abc123\n");
    expect(exec.exec("git rev-parse HEAD")).toBe("abc123\n");
  });

  it("supports function-valued responders", () => {
    const exec = createMockExec();
    let calls = 0;
    exec.register("date", () => {
      calls++;
      return `call-${calls}`;
    });
    expect(exec.exec("date")).toBe("call-1");
    expect(exec.exec("date")).toBe("call-2");
  });

  it("throws registered Error", () => {
    const exec = createMockExec();
    exec.register("git rev-parse HEAD", new Error("boom"));
    expect(() => exec.exec("git rev-parse HEAD")).toThrow("boom");
  });

  it("throws 'unmocked exec command' for unmatched input", () => {
    const exec = createMockExec();
    expect(() => exec.exec("rm -rf /")).toThrow(/unmocked exec command: rm -rf \//);
  });

  it("reset clears the registry", () => {
    const exec = createMockExec();
    exec.register("ls", "x\n");
    expect(exec.prefixes()).toEqual(["ls"]);
    exec.reset();
    expect(exec.prefixes()).toEqual([]);
    expect(() => exec.exec("ls")).toThrow(/unmocked exec command/);
  });
});

// =====================================================================
// mock-time
// =====================================================================

describe("mock-time helper", () => {
  afterEach(() => {
    useRealTimers();
    resetTime();
  });

  it("pins Date.now() to a fixed instant", () => {
    setFakeTime("2026-01-15T12:00:00.000Z");
    expect(new Date().toISOString()).toBe("2026-01-15T12:00:00.000Z");
    expect(Date.now()).toBe(Date.parse("2026-01-15T12:00:00.000Z"));
  });

  it("accepts numeric and Date inputs", () => {
    const t = Date.parse("2030-06-01T00:00:00.000Z");
    setFakeTime(t);
    expect(Date.now()).toBe(t);

    setFakeTime(new Date(t + 5000));
    expect(Date.now()).toBe(t + 5000);
  });

  it("resetTime restores the real clock", () => {
    setFakeTime("1999-01-01T00:00:00Z");
    expect(new Date().getFullYear()).toBe(1999);
    resetTime();
    expect(new Date().getFullYear()).toBeGreaterThan(2020);
  });

  it("useFakeTimers + advanceTime fires setTimeout callbacks", () => {
    useFakeTimers();
    let fired = 0;
    setTimeout(() => {
      fired++;
    }, 1000);
    advanceTime(999);
    expect(fired).toBe(0);
    advanceTime(1);
    expect(fired).toBe(1);
  });

  it("clearTimeout cancels a pending timer", () => {
    useFakeTimers();
    let fired = false;
    const id = setTimeout(() => {
      fired = true;
    }, 1000);
    clearTimeout(id);
    advanceTime(5000);
    expect(fired).toBe(false);
  });

  it("setInterval fires repeatedly", () => {
    useFakeTimers();
    let ticks = 0;
    const id = setInterval(() => {
      ticks++;
    }, 100);
    advanceTime(350);
    expect(ticks).toBe(3); // fires at 100, 200, 300
    clearInterval(id);
    advanceTime(500);
    expect(ticks).toBe(3);
  });
});

// =====================================================================
// git fixture
// =====================================================================

describe("git fixture (setup.sh)", () => {
  const repo = useTmpDir("git-fixture");

  it("setup.sh script exists and is executable", () => {
    expect(existsSync(GIT_SETUP)).toBe(true);
  });

  it("running setup.sh configures user.email=test@example.com", () => {
    // run setup.sh inside the tmp repo dir
    execSync(`bash ${JSON.stringify(GIT_SETUP)} ${JSON.stringify(repo)}`, {
      encoding: "utf-8",
    });
    const email = execSync("git config user.email", {
      cwd: repo,
      encoding: "utf-8",
    }).trim();
    const name = execSync("git config user.name", {
      cwd: repo,
      encoding: "utf-8",
    }).trim();
    expect(email).toBe("test@example.com");
    expect(name).toBe("Test User");
  });

  it("setup.sh is idempotent (second run also exits 0)", () => {
    execSync(`bash ${JSON.stringify(GIT_SETUP)} ${JSON.stringify(repo)}`, {
      encoding: "utf-8",
    });
    // a HEAD commit must exist
    const head = execSync("git rev-parse --verify HEAD", {
      cwd: repo,
      encoding: "utf-8",
    }).trim();
    expect(head).toMatch(/^[0-9a-f]{7,}$/);
  });
});

// =====================================================================
// fixture files exist
// =====================================================================

describe("fixture inventory", () => {
  const fixturesRoot = resolve(REPO_ROOT, "tests", "fixtures");

  it("has 6 JSONC config samples", () => {
    const expected = [
      "minimal.jsonc",
      "maximal.jsonc",
      "with-comments.jsonc",
      "with-trailing-commas.jsonc",
      "mixed-quotes.jsonc",
      "malformed.jsonc",
    ];
    for (const name of expected) {
      expect(existsSync(join(fixturesRoot, "configs", name))).toBe(true);
    }
  });

  it("has 3 message samples", () => {
    const expected = ["with-private-tag.md", "fully-private.md", "with-code-blocks.md"];
    for (const name of expected) {
      expect(existsSync(join(fixturesRoot, "messages", name))).toBe(true);
    }
  });
});
