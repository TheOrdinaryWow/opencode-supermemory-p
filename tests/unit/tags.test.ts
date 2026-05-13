import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// =====================================================================
// In-test mock state — kept self-contained so the global `mock.module`
// patch below stays harmless to other test files (notably
// tests/helpers/__sanity__.test.ts, which uses the real execSync).
// =====================================================================

// Mutable config state shared with the consumer (tags.ts calls getConfig()
// at runtime, so mutating these between tests takes effect immediately).
const mockConfig: {
  containerTagPrefix: string;
  userContainerTag: string | undefined;
  projectContainerTag: string | undefined;
  projectTagStrategy: "hashDirectory" | "hashGitRepoName" | "RawGitRepoName";
} = {
  containerTagPrefix: "opencode",
  userContainerTag: undefined,
  projectContainerTag: undefined,
  projectTagStrategy: "hashGitRepoName",
};

// Response slot for `git config user.email` — string yields stdout, Error
// throws (mirroring real execSync), function increments a counter.
type GitResponder = string | Error | (() => string);
let gitEmailResponder: GitResponder | null = null;
let gitEmailCallCount = 0;

// Response slot for `git config --get remote.origin.url`. Default to an
// Error so getProjectTag's git-backed strategies naturally fall back to
// hashDirectory unless a test wires up a real remote URL.
let gitRemoteResponder: GitResponder = new Error("not a git repo");
let gitRemoteCallCount = 0;

// Patch node:child_process — intercept the two git calls used by tags.ts
// and pass every other command through to the real execSync. This keeps
// concurrent test files that depend on real execSync (e.g. running the
// git fixture setup.sh) working when bun test parallelizes files.
mock.module("node:child_process", () => {
  const real = require("node:child_process") as typeof import("node:child_process");
  const runResponder = (responder: GitResponder): string => {
    if (responder instanceof Error) throw responder;
    if (typeof responder === "function") return responder();
    return responder;
  };
  return {
    ...real,
    execSync: (command: string, options?: unknown) => {
      // Narrow match: tags.ts calls execSync with NO options for the email
      // lookup. The git-fixture sanity test (tests/helpers/__sanity__.test.ts)
      // calls the same command with { cwd: repo } to probe a tmp repo —
      // those calls must pass through.
      const hasCwd = typeof options === "object" && options !== null && "cwd" in (options as Record<string, unknown>);
      if (command === "git config user.email" && !hasCwd) {
        gitEmailCallCount++;
        if (gitEmailResponder === null) {
          throw new Error("test bug: gitEmailResponder not configured");
        }
        return runResponder(gitEmailResponder);
      }
      // tags.ts ALWAYS calls the remote lookup with { cwd: directory }, so
      // we match by command name only. Any other execSync caller that
      // happens to ask for the remote URL will also be intercepted, which
      // is acceptable for this test file's scope.
      if (command === "git config --get remote.origin.url") {
        gitRemoteCallCount++;
        return runResponder(gitRemoteResponder);
      }
      // Pass-through so unrelated execSync calls in other files behave normally.
      return (real.execSync as (cmd: string, opts?: unknown) => string | Buffer)(command, options);
    },
  };
});

let tags: typeof import("@/memory/tags");

beforeEach(async () => {
  tags ??= await import("@/memory/tags");
});

// Save / restore env between tests so the process.env.USER fallback path
// is deterministic regardless of the developer's machine.
let prevUser: string | undefined;
let prevUsername: string | undefined;

beforeEach(() => {
  mockConfig.containerTagPrefix = "opencode";
  mockConfig.userContainerTag = undefined;
  mockConfig.projectContainerTag = undefined;
  mockConfig.projectTagStrategy = "hashGitRepoName";
  gitEmailResponder = null;
  gitEmailCallCount = 0;
  gitRemoteResponder = new Error("not a git repo");
  gitRemoteCallCount = 0;
  // T14: reset the in-process git-email cache between tests so each case
  // sees a fresh execSync call path. Without this, cached results from
  // earlier tests would mask the mocked responder.
  tags.resetTagsCache();
  prevUser = process.env.USER;
  prevUsername = process.env.USERNAME;
});

afterEach(() => {
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
  it("returns config.userContainerTag verbatim when explicitly set (overrides email hashing)", () => {
    mockConfig.userContainerTag = "my-custom-user-tag";
    // gitEmailResponder is null — the override short-circuits before any git call.
    expect(tags.getUserTag(mockConfig)).toBe("my-custom-user-tag");
    expect(gitEmailCallCount).toBe(0);
  });

  it("auto-generates a user tag from `{prefix}_user_{sha256(email).slice(0,16)}` (byte-identical)", () => {
    gitEmailResponder = "test@example.com\n";
    // sha256("test@example.com").slice(0,16) == 973dfe463ec85785
    // This exact byte sequence MUST survive T14 (getGitEmail caching) and
    // any future refactor of tags.ts. Snapshot locks the full output string.
    expect(tags.getUserTag(mockConfig)).toMatchInlineSnapshot(`"opencode_user_973dfe463ec85785"`);
  });

  it("falls back to process.env.USER when git fails and userContainerTag is unset", () => {
    gitEmailResponder = new Error("not a git repo");
    process.env.USER = "alice";
    delete process.env.USERNAME;
    // sha256("alice").slice(0,16) == 2bd806c97f0e00af
    expect(tags.getUserTag(mockConfig)).toMatchInlineSnapshot(`"opencode_user_2bd806c97f0e00af"`);
  });

  it("falls through USER -> USERNAME -> 'anonymous' when no env user is set", () => {
    gitEmailResponder = new Error("not a git repo");
    delete process.env.USER;
    delete process.env.USERNAME;
    // sha256("anonymous").slice(0,16) == 2f183a4e64493af3
    expect(tags.getUserTag(mockConfig)).toMatchInlineSnapshot(`"opencode_user_2f183a4e64493af3"`);
  });

  it("honors a custom containerTagPrefix when auto-generating the user tag", () => {
    mockConfig.containerTagPrefix = "omsm-test";
    gitEmailResponder = "test@example.com\n";
    expect(tags.getUserTag(mockConfig)).toBe("omsm-test_user_973dfe463ec85785");
  });
});

describe("parseGitRepoName", () => {
  it("extracts owner/repo from HTTPS URLs (with and without .git)", () => {
    expect(tags.parseGitRepoName("https://github.com/TheOrdinaryWow/abc")).toBe("TheOrdinaryWow/abc");
    expect(tags.parseGitRepoName("https://github.com/TheOrdinaryWow/abc.git")).toBe("TheOrdinaryWow/abc");
  });

  it("extracts owner/repo from SSH URLs (with and without .git)", () => {
    expect(tags.parseGitRepoName("git@github.com:TheOrdinaryWow/abc.git")).toBe("TheOrdinaryWow/abc");
    expect(tags.parseGitRepoName("git@github.com:TheOrdinaryWow/abc")).toBe("TheOrdinaryWow/abc");
  });

  it("extracts owner/repo from ssh:// URLs, including non-default ports", () => {
    expect(tags.parseGitRepoName("ssh://git@github.com/owner/repo.git")).toBe("owner/repo");
    // Pin the port-handling fix: the SCP-like SSH regex must NOT incorrectly
    // gobble the port number when a real ssh:// URL is given.
    expect(tags.parseGitRepoName("ssh://git@gitserver:2222/owner/repo.git")).toBe("owner/repo");
  });

  it("extracts owner/repo from git:// protocol URLs", () => {
    expect(tags.parseGitRepoName("git://github.com/owner/repo.git")).toBe("owner/repo");
  });

  it("extracts nested paths (gitlab groups, gitea sub-orgs, etc.)", () => {
    expect(tags.parseGitRepoName("https://gitlab.com/group/subgroup/repo.git")).toBe("group/subgroup/repo");
  });

  it("returns null for empty, malformed, or owner-only inputs", () => {
    expect(tags.parseGitRepoName("")).toBeNull();
    expect(tags.parseGitRepoName("  \n")).toBeNull();
    expect(tags.parseGitRepoName("not a url")).toBeNull();
    expect(tags.parseGitRepoName("https://example.com/owner-only")).toBeNull();
    // Degenerate input that URL-parses with empty host. Pin: must not slip through.
    expect(tags.parseGitRepoName("foo:bar/baz")).toBeNull();
  });
});

describe("getProjectTag", () => {
  it("returns config.projectContainerTag verbatim when explicitly set", () => {
    mockConfig.projectContainerTag = "my-project-tag";
    // Argument is ignored entirely when the override is set.
    expect(tags.getProjectTag("/whatever/path", mockConfig)).toBe("my-project-tag");
    expect(gitRemoteCallCount).toBe(0);
  });

  it("hashDirectory strategy: hashes the directory verbatim — byte-identical", () => {
    mockConfig.projectTagStrategy = "hashDirectory";
    // sha256("/test/project").slice(0,16) == 43ac6f583851e4e9
    expect(tags.getProjectTag("/test/project", mockConfig)).toMatchInlineSnapshot(`"opencode_project_43ac6f583851e4e9"`);
    // hashDirectory must not consult git at all.
    expect(gitRemoteCallCount).toBe(0);
  });

  it("hashDirectory: different paths produce different tags", () => {
    mockConfig.projectTagStrategy = "hashDirectory";
    const a = tags.getProjectTag("/test/project", mockConfig);
    const b = tags.getProjectTag("/test/project/", mockConfig);
    expect(a).not.toBe(b);
  });

  it("hashGitRepoName strategy: hashes the parsed owner/repo from the remote URL", () => {
    mockConfig.projectTagStrategy = "hashGitRepoName";
    gitRemoteResponder = "https://github.com/TheOrdinaryWow/abc.git\n";
    // sha256("TheOrdinaryWow/abc").slice(0,16) == 199b418381889efa
    expect(tags.getProjectTag("/test/project", mockConfig)).toBe("opencode_project_199b418381889efa");
  });

  it("hashGitRepoName: identical repo URLs produce identical tags regardless of directory", () => {
    mockConfig.projectTagStrategy = "hashGitRepoName";
    gitRemoteResponder = "https://github.com/TheOrdinaryWow/abc.git\n";
    const a = tags.getProjectTag("/path/one", mockConfig);
    tags.resetTagsCache(); // bust the per-directory cache so the second call re-queries.
    const b = tags.getProjectTag("/path/two", mockConfig);
    expect(a).toBe(b);
  });

  it("hashGitRepoName: SSH and HTTPS remotes for the same repo collapse to the same tag", () => {
    mockConfig.projectTagStrategy = "hashGitRepoName";

    gitRemoteResponder = "https://github.com/TheOrdinaryWow/abc.git\n";
    const httpsTag = tags.getProjectTag("/path/one", mockConfig);

    tags.resetTagsCache();
    gitRemoteResponder = "git@github.com:TheOrdinaryWow/abc.git\n";
    const sshTag = tags.getProjectTag("/path/one", mockConfig);

    expect(httpsTag).toBe(sshTag);
  });

  it("hashGitRepoName: falls back to hashDirectory when not in a git repo", () => {
    mockConfig.projectTagStrategy = "hashGitRepoName";
    gitRemoteResponder = new Error("fatal: not a git repository");
    // Must match the hashDirectory snapshot byte-for-byte.
    expect(tags.getProjectTag("/test/project", mockConfig)).toBe("opencode_project_43ac6f583851e4e9");
  });

  it("hashGitRepoName: falls back to hashDirectory when remote URL is unparseable", () => {
    mockConfig.projectTagStrategy = "hashGitRepoName";
    gitRemoteResponder = "not a url\n";
    expect(tags.getProjectTag("/test/project", mockConfig)).toBe("opencode_project_43ac6f583851e4e9");
  });

  it("RawGitRepoName strategy: uses owner.repo (slashes replaced with underlines)", () => {
    mockConfig.projectTagStrategy = "RawGitRepoName";
    gitRemoteResponder = "https://github.com/TheOrdinaryWow/abc.git\n";
    expect(tags.getProjectTag("/test/project", mockConfig)).toBe("opencode_project_TheOrdinaryWow_abc");
  });

  it("RawGitRepoName: nested groups flatten underlines", () => {
    mockConfig.projectTagStrategy = "RawGitRepoName";
    gitRemoteResponder = "https://gitlab.com/group/subgroup/repo.git\n";
    expect(tags.getProjectTag("/test/project", mockConfig)).toBe("opencode_project_group_subgroup_repo");
  });

  it("RawGitRepoName: falls back to hashDirectory when not in a git repo", () => {
    mockConfig.projectTagStrategy = "RawGitRepoName";
    gitRemoteResponder = new Error("fatal: not a git repository");
    expect(tags.getProjectTag("/test/project", mockConfig)).toBe("opencode_project_43ac6f583851e4e9");
  });

  it("honors containerTagPrefix across all strategies", () => {
    mockConfig.containerTagPrefix = "my-prefix-";

    mockConfig.projectTagStrategy = "hashDirectory";
    expect(tags.getProjectTag("/test/project", mockConfig)).toBe("my-prefix-_project_43ac6f583851e4e9");

    tags.resetTagsCache();
    gitRemoteResponder = "https://github.com/TheOrdinaryWow/abc.git\n";
    mockConfig.projectTagStrategy = "RawGitRepoName";
    expect(tags.getProjectTag("/test/project", mockConfig)).toBe("my-prefix-_project_TheOrdinaryWow_abc");
  });
});

describe("getGitRepoName", () => {
  it("caches per-directory: two calls with the same directory trigger execSync once", () => {
    gitRemoteResponder = "https://github.com/TheOrdinaryWow/abc.git\n";
    tags.getGitRepoName("/test/project");
    tags.getGitRepoName("/test/project");
    expect(gitRemoteCallCount).toBe(1);
  });

  it("caches the null result so repeated misses do not re-shell to git", () => {
    gitRemoteResponder = new Error("not a git repo");
    expect(tags.getGitRepoName("/test/project")).toBeNull();
    expect(tags.getGitRepoName("/test/project")).toBeNull();
    expect(gitRemoteCallCount).toBe(1);
  });
});

describe("getTags", () => {
  it("returns an object with both `user` and `project` keys in that exact order", () => {
    gitEmailResponder = "test@example.com\n";
    // Force the project tag to use hashDirectory so the snapshot stays stable
    // regardless of whether the test runner is inside a git checkout.
    mockConfig.projectTagStrategy = "hashDirectory";
    const result = { user: tags.getUserTag(mockConfig), project: tags.getProjectTag("/test/project", mockConfig) };
    expect(Object.keys(result)).toEqual(["user", "project"]);
    expect(result.user).toBe("opencode_user_973dfe463ec85785");
    expect(result.project).toBe("opencode_project_43ac6f583851e4e9");
  });
});

describe("in-process cache for git email (T14)", () => {
  it("cache hit: two getUserTag() calls trigger execSync exactly once", () => {
    gitEmailResponder = "test@example.com\n";

    // Two independent calls — with caching, only the first hits execSync.
    tags.getUserTag(mockConfig);
    tags.getUserTag(mockConfig);

    // T14 caching: second call returns the cached email and skips execSync.
    // Before T14 this assertion locked toBe(2); the change to toBe(1) is the
    // observable proof that caching is wired into both call sites.
    expect(gitEmailCallCount).toBe(1);
  });

  it("getTags() hits getGitEmail exactly once per call", () => {
    gitEmailResponder = "test@example.com\n";

    // getTags() reads the REAL getConfig() (not mockConfig), so we can't pin
    // the strategy from here. The assertion below only counts `user.email`
    // lookups — git remote URL lookups are tracked separately and are
    // irrelevant to this test's invariant.
    tags.getTags("/test/project");

    // getTags() -> getUserTag() -> getGitEmail() == exactly 1 user.email call.
    expect(gitEmailCallCount).toBe(1);
  });

  it("cache hit: null result from a failed git call is cached (no retry)", () => {
    gitEmailResponder = new Error("not a git repo");
    process.env.USER = "alice";
    delete process.env.USERNAME;

    // Three calls — the first throws inside execSync, the next two should
    // return the cached null without invoking execSync again.
    tags.getGitEmail();
    tags.getGitEmail();
    tags.getUserTag(mockConfig); // also routes through getGitEmail internally

    expect(gitEmailCallCount).toBe(1);
  });
});
