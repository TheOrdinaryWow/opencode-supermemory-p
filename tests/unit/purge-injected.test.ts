import { describe, expect, it, mock } from "bun:test";

import {
  deleteMemories,
  findPolluted,
  listAllMemories,
  type MemoryRecord,
  POLLUTION_PATTERNS,
  type PurgeApi,
} from "../../scripts/purge-injected";

describe("findPolluted", () => {
  it("detects every OMO marker pattern", () => {
    const samples: MemoryRecord[] = [
      { id: "a", content: "<auto-slash-command>x</auto-slash-command>" },
      { id: "b", summary: "<command-instruction>y</command-instruction>" },
      { id: "c", content: "[user] <system-reminder>z</system-reminder>" },
      { id: "d", content: "<session-context>...</session-context>" },
      { id: "e", content: "<user-request>real</user-request>" },
      { id: "f", content: "<user-task>do x</user-task>" },
      { id: "g", content: "[SYSTEM DIRECTIVE: OH-MY-OPENCODE - X]" },
      { id: "h", content: "[restore checkpointed session agent configuration after compaction]" },
      { id: "i", content: "<!-- OMO_INTERNAL_INITIATOR -->" },
      { id: "j", content: "You are starting a Sisyphus work session." },
    ];

    const matches = findPolluted(samples);

    expect(matches).toHaveLength(samples.length);
    expect(matches.map((m) => m.id).sort()).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
  });

  it("ignores memories with no markers", () => {
    const clean: MemoryRecord[] = [
      { id: "x", content: "User prefers concise responses" },
      { id: "y", summary: "Project uses Bun for testing" },
      { id: "z", title: "API reference" },
    ];

    expect(findPolluted(clean)).toHaveLength(0);
  });

  it("handles memories missing all text fields", () => {
    const empty: MemoryRecord[] = [{ id: "blank" }, { id: "null", content: null, summary: null, title: null }];

    expect(findPolluted(empty)).toHaveLength(0);
  });

  it("captures preview, tags, createdAt for surfacing in dry-run", () => {
    const memory: MemoryRecord = {
      id: "preview_one",
      content: "[user] <system-reminder>SINGLE TASK ONLY</system-reminder>",
      containerTags: ["opencode_project_xxx"],
      createdAt: "2026-05-13T20:31:00Z",
    };

    const [match] = findPolluted([memory]);
    expect(match?.id).toBe("preview_one");
    expect(match?.pattern).toBe(POLLUTION_PATTERNS.find((p) => p.source.includes("system-reminder"))?.source);
    expect(match?.preview).toContain("SINGLE TASK ONLY");
    expect(match?.containerTags).toEqual(["opencode_project_xxx"]);
    expect(match?.createdAt).toBe("2026-05-13T20:31:00Z");
  });

  it("stops at first matching pattern (no double-count)", () => {
    const multi: MemoryRecord = {
      id: "multi",
      content: "<system-reminder>x</system-reminder><session-context>y</session-context>",
    };

    const matches = findPolluted([multi]);
    expect(matches).toHaveLength(1);
  });
});

describe("listAllMemories", () => {
  function makeApi(pages: Array<{ memories: MemoryRecord[]; pagination?: { currentPage: number; totalPages: number } }>): PurgeApi {
    let callCount = 0;
    return {
      listPage: mock(async (_page: number) => {
        const result = pages[callCount] ?? { memories: [] };
        callCount += 1;
        return result;
      }),
      deleteMemory: mock(async () => ({ ok: true, status: 204 })),
    };
  }

  it("walks all pages and dedups by id", async () => {
    const api = makeApi([
      { memories: [{ id: "1" }, { id: "2" }], pagination: { currentPage: 1, totalPages: 2 } },
      { memories: [{ id: "3" }], pagination: { currentPage: 2, totalPages: 2 } },
    ]);

    const all = await listAllMemories(api);
    expect(all.map((m) => m.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("stops when a page returns zero new entries (defensive against broken pagination)", async () => {
    const api = makeApi([
      { memories: [{ id: "1" }], pagination: { currentPage: 1, totalPages: 99 } },
      { memories: [{ id: "1" }], pagination: { currentPage: 1, totalPages: 99 } },
    ]);

    const all = await listAllMemories(api, { safetyLimit: 10 });
    expect(all).toHaveLength(1);
  });

  it("respects safetyLimit", async () => {
    const api = makeApi(
      Array.from({ length: 50 }, (_, i) => ({ memories: [{ id: String(i) }], pagination: { currentPage: i + 1, totalPages: 100 } })),
    );

    const all = await listAllMemories(api, { safetyLimit: 3 });
    expect(all.length).toBeLessThanOrEqual(3);
  });

  it("returns empty when first page is empty", async () => {
    const api = makeApi([{ memories: [] }]);

    expect(await listAllMemories(api)).toEqual([]);
  });
});

describe("deleteMemories", () => {
  it("partitions deleted vs failed by status", async () => {
    const api: PurgeApi = {
      listPage: mock(async () => ({ memories: [] })),
      deleteMemory: mock(async (id: string) => {
        if (id === "fail") return { ok: false, status: 500 };
        return { ok: true, status: 204 };
      }),
    };

    const result = await deleteMemories(api, ["a", "fail", "b"]);
    expect(result.deleted).toEqual(["a", "b"]);
    expect(result.failed).toEqual([{ id: "fail", status: 500 }]);
  });

  it("calls deleteMemory once per id", async () => {
    const deleteMemory = mock(async () => ({ ok: true, status: 204 }));
    const api: PurgeApi = {
      listPage: mock(async () => ({ memories: [] })),
      deleteMemory,
    };

    await deleteMemories(api, ["a", "b", "c"]);
    expect(deleteMemory).toHaveBeenCalledTimes(3);
  });

  it("returns empty result for empty input", async () => {
    const deleteMemory = mock(async () => ({ ok: true, status: 204 }));
    const api: PurgeApi = {
      listPage: mock(async () => ({ memories: [] })),
      deleteMemory,
    };

    const result = await deleteMemories(api, []);
    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(deleteMemory).toHaveBeenCalledTimes(0);
  });
});
