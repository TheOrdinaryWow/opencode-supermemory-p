import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const CONFIG_ABS = join(REPO_ROOT, "src", "config.ts");

// =====================================================================
// In-test mock state — kept self-contained so the global `mock.module`
// patch below stays harmless to other test files (notably
// tests/helpers/__sanity__.test.ts, which uses the real execSync).
// =====================================================================

// Mutable CONFIG state shared with the consumer (tags.ts reads CONFIG.xxx
// at runtime, so mutating these between tests takes effect immediately).
const mockConfig: {
  containerTagPrefix: string;
  userContainerTag: string | undefined;
  projectContainerTag: string | undefined;
} = {
  containerTagPrefix: "opencode",
  userContainerTag: undefined,
  projectContainerTag: undefined,
};

// Response slot for `git config user.email` — string yields stdout, Error
// throws (mirroring real execSync), function increments a counter.
type GitEmailResponder = string | Error | (() => string);
let gitEmailResponder: GitEmailResponder | null = null;
let gitEmailCallCount = 0;

// Mock src/config.ts so tags.ts sees a deterministic CONFIG object.
mock.module(CONFIG_ABS, () => ({
  CONFIG: mockConfig,
  SUPERMEMORY_API_KEY: "test-key",
  isConfigured: () => true,
}));

// Patch node:child_process — intercept ONLY `git config user.email` and
// pass every other command through to the real execSync. This keeps
// concurrent test files that depend on real execSync (e.g. running the
// git fixture setup.sh) working when bun test parallelizes files.
mock.module("node:child_process", () => {
  const real = require("node:child_process") as typeof import("node:child_process");
  return {
    ...real,
    execSync: (command: string, options?: unknown) => {
      if (command === "git config user.email") {
        gitEmailCallCount++;
        if (gitEmailResponder === null) {
          throw new Error("test bug: gitEmailResponder not configured");
        }
        if (gitEmailResponder instanceof Error) throw gitEmailResponder;
        if (typeof gitEmailResponder === "function") return gitEmailResponder();
        return gitEmailResponder;
      }
      // Pass-through so unrelated execSync calls in other files behave normally.
      return (real.execSync as (cmd: string, opts?: unknown) => string | Buffer)(command, options);
    },
  };
});

let tags: typeof import("../../src/services/tags.ts");

// Save / restore env between tests so the process.env.USER fallback path
// is deterministic regardless of the developer's machine.
let prevUser: string | undefined;
let prevUsername: string | undefined;

beforeAll(async () => {
  tags = await import("../../src/services/tags.ts");
});

beforeEach(() => {
  mockConfig.containerTagPrefix = "opencode";
  mockConfig.userContainerTag = undefined;
  mockConfig.projectContainerTag = undefined;
  gitEmailResponder = null;
  gitEmailCallCount = 0;
  prevUser = process.env.USER;
  prevUsername = process.env.USERNAME;
});

afterAll(() => {
  if (prevUser === undefined) delete process.env.USER;
  else process.env.USER = prevUser;
  if (prevUsername === undefined) delete process.env.USERNAME;
  else process.env.USERNAME = prevUsername;
});

describe("getGitEmail", () => {
  it("returns the trimmed email when `git config user.email` succeeds", () => {
    gitEmailResponder = "test@example.com\n";
    expect(tags.getGitEmail()).toBe("test@example.com");
  });

  it("returns null when `git config user.email` throws (not a git repo)", () => {
    gitEmailResponder = new Error("fatal: not a git repo");
    expect(tags.getGitEmail()).toBeNull();
  });

  it("returns null when `git config user.email` outputs only whitespace", () => {
    // Locks current behavior: empty-after-trim is normalized to null so the
    // caller falls through to the env-var fallback path.
    gitEmailResponder = "   \n";
    expect(tags.getGitEmail()).toBeNull();
  });
});

describe("getUserTag", () => {
  it("returns CONFIG.userContainerTag verbatim when explicitly set (overrides email hashing)", () => {
    mockConfig.userContainerTag = "my-custom-user-tag";
    // gitEmailResponder is null — the override short-circuits before any git call.
    expect(tags.getUserTag()).toBe("my-custom-user-tag");
    expect(gitEmailCallCount).toBe(0);
  });

  it("auto-generates a user tag from `{prefix}_user_{sha256(email).slice(0,16)}` (byte-identical)", () => {
    gitEmailResponder = "test@example.com\n";
    // sha256("test@example.com").slice(0,16) == 973dfe463ec85785
    // This exact byte sequence MUST survive T14 (getGitEmail caching) and
    // any future refactor of tags.ts. Snapshot locks the full output string.
    expect(tags.getUserTag()).toMatchInlineSnapshot(`"opencode_user_973dfe463ec85785"`);
  });

  it("falls back to process.env.USER when git fails and userContainerTag is unset", () => {
    gitEmailResponder = new Error("not a git repo");
    process.env.USER = "alice";
    delete process.env.USERNAME;
    // sha256("alice").slice(0,16) == 2bd806c97f0e00af
    expect(tags.getUserTag()).toMatchInlineSnapshot(`"opencode_user_2bd806c97f0e00af"`);
  });

  it("falls through USER -> USERNAME -> 'anonymous' when no env user is set", () => {
    gitEmailResponder = new Error("not a git repo");
    delete process.env.USER;
    delete process.env.USERNAME;
    // sha256("anonymous").slice(0,16) == 2f183a4e64493af3
    expect(tags.getUserTag()).toMatchInlineSnapshot(`"opencode_user_2f183a4e64493af3"`);
  });

  it("honors a custom containerTagPrefix when auto-generating the user tag", () => {
    mockConfig.containerTagPrefix = "omsm-test";
    gitEmailResponder = "test@example.com\n";
    expect(tags.getUserTag()).toBe("omsm-test_user_973dfe463ec85785");
  });
});

describe("getProjectTag", () => {
  it("returns CONFIG.projectContainerTag verbatim when explicitly set", () => {
    mockConfig.projectContainerTag = "my-project-tag";
    // Argument is ignored entirely when the override is set.
    expect(tags.getProjectTag("/whatever/path")).toBe("my-project-tag");
  });

  it("auto-generates a project tag from `{prefix}_project_{sha256(directory).slice(0,16)}` (byte-identical)", () => {
    // sha256("/test/project").slice(0,16) == 43ac6f583851e4e9
    expect(tags.getProjectTag("/test/project")).toMatchInlineSnapshot(`"opencode_project_43ac6f583851e4e9"`);
  });

  it("hashes the directory verbatim — different paths produce different tags", () => {
    const a = tags.getProjectTag("/test/project");
    const b = tags.getProjectTag("/test/project/");
    expect(a).not.toBe(b);
  });
});

describe("getTags", () => {
  it("returns an object with both `user` and `project` keys in that exact order", () => {
    gitEmailResponder = "test@example.com\n";
    const result = tags.getTags("/test/project");
    expect(Object.keys(result)).toEqual(["user", "project"]);
    expect(result.user).toBe("opencode_user_973dfe463ec85785");
    expect(result.project).toBe("opencode_project_43ac6f583851e4e9");
  });
});

describe("characterization for T14 (caching refactor)", () => {
  it("calls execSync ONCE per getGitEmail invocation today (T14 will collapse repeated calls to 1)", () => {
    gitEmailResponder = "test@example.com\n";

    // Two independent calls — today each triggers its own execSync.
    tags.getUserTag();
    tags.getUserTag();

    // Locks current behavior: 2 invocations -> 2 exec calls. After the T14
    // caching refactor this assertion must change to `toBe(1)` (one cached
    // lookup), confirming the caching is wired into both call sites.
    expect(gitEmailCallCount).toBe(2);
  });

  it("getTags() hits getGitEmail exactly once per call (project tag does not consult git)", () => {
    gitEmailResponder = "test@example.com\n";

    tags.getTags("/test/project");

    // Today getTags() -> getUserTag() -> getGitEmail() == 1 call.
    // getProjectTag does NOT touch git, so a single getTags() yields one
    // git call total.
    expect(gitEmailCallCount).toBe(1);
  });
});
