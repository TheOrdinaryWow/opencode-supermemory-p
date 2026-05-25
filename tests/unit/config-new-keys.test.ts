import { describe, expect, it } from "bun:test";

// =====================================================================
// Config Schema + Defaults: 18 new keys
//
// Locks the contract that every new memory-feature key:
//   1. Has a default value in src/config/defaults.ts (DEFAULTS table)
//   2. Has a Zod validator in src/config/schema.ts that uses .catch()
//      for silent-recovery on malformed input (never throws).
//   3. Surfaces through SupermemoryConfigSchema.parse({}) at the
//      documented default.
//
// Policy (decisions.md): "safe-on, costly-off" — the three costly
// features default to false/0, every other new key defaults to a
// non-trivial enabled value.
// =====================================================================

describe("new constants — DEFAULT_SIGNAL_KEYWORDS / DEFAULT_RECALL_KEYWORD_PATTERNS / DEFAULT_ENTITY_CONTEXT", () => {
  it("DEFAULT_SIGNAL_KEYWORDS exports an array of exactly 14 English terms", async () => {
    const { DEFAULT_SIGNAL_KEYWORDS } = await import("@/config/defaults");
    expect(Array.isArray(DEFAULT_SIGNAL_KEYWORDS)).toBe(true);
    expect(DEFAULT_SIGNAL_KEYWORDS).toHaveLength(14);
    // Spot-check the documented terms; the loader merges this with
    // user-supplied keywords downstream.
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("remember");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("save this");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("note this");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("don't forget");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("key decision");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("project info");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("my name");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("I work");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("I prefer");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("I use");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("I like");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("my team");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("my email");
    expect(DEFAULT_SIGNAL_KEYWORDS).toContain("my company");
  });

  it("DEFAULT_SIGNAL_KEYWORDS does not include the high-false-positive adverbs", async () => {
    const { DEFAULT_SIGNAL_KEYWORDS } = await import("@/config/defaults");
    // These were removed because they fire on engineering specs and
    // sub-agent task briefs, producing massive scaffolding captures.
    expect(DEFAULT_SIGNAL_KEYWORDS).not.toContain("always");
    expect(DEFAULT_SIGNAL_KEYWORDS).not.toContain("never");
    expect(DEFAULT_SIGNAL_KEYWORDS).not.toContain("important");
  });

  it("DEFAULT_RECALL_KEYWORD_PATTERNS exports a non-empty array of recall trigger phrases", async () => {
    const { DEFAULT_RECALL_KEYWORD_PATTERNS } = await import("@/config/defaults");
    expect(Array.isArray(DEFAULT_RECALL_KEYWORD_PATTERNS)).toBe(true);
    expect(DEFAULT_RECALL_KEYWORD_PATTERNS.length).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_RECALL_KEYWORD_PATTERNS).toContain("what did we");
    expect(DEFAULT_RECALL_KEYWORD_PATTERNS).toContain("remind me");
    expect(DEFAULT_RECALL_KEYWORD_PATTERNS).toContain("earlier you said");
    expect(DEFAULT_RECALL_KEYWORD_PATTERNS).toContain("what was the");
    expect(DEFAULT_RECALL_KEYWORD_PATTERNS).toContain("do you remember");
  });

  it("DEFAULT_ENTITY_CONTEXT exports a non-empty string clamped to <= 1500 characters", async () => {
    const { DEFAULT_ENTITY_CONTEXT } = await import("@/config/defaults");
    expect(typeof DEFAULT_ENTITY_CONTEXT).toBe("string");
    expect(DEFAULT_ENTITY_CONTEXT.length).toBeGreaterThan(0);
    expect(DEFAULT_ENTITY_CONTEXT.length).toBeLessThanOrEqual(1500);
    // Anchor: the verbatim openclaw-supermemory text starts with this prefix.
    expect(DEFAULT_ENTITY_CONTEXT).toContain("User-assistant conversation");
  });
});

describe("SupermemoryConfigSchema — 15 safe-on defaults applied on empty input", () => {
  it("incrementalCapture defaults to true", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).incrementalCapture).toBe(true);
  });

  it("maxCaptureChars defaults to 5000", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).maxCaptureChars).toBe(5000);
  });

  it("postCompactionReinject defaults to true", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).postCompactionReinject).toBe(true);
  });

  it("sessionEndSave defaults to true", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).sessionEndSave).toBe(true);
  });

  it("signalExtraction defaults to true", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).signalExtraction).toBe(true);
  });

  it("signalKeywords defaults to DEFAULT_SIGNAL_KEYWORDS (17 terms)", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    const { DEFAULT_SIGNAL_KEYWORDS } = await import("@/config/defaults");
    const parsed = SupermemoryConfigSchema.parse({});
    expect(parsed.signalKeywords).toEqual([...DEFAULT_SIGNAL_KEYWORDS]);
  });

  it("signalTurnsBefore defaults to 3", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).signalTurnsBefore).toBe(3);
  });

  it("recallKeywordPatterns defaults to DEFAULT_RECALL_KEYWORD_PATTERNS", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    const { DEFAULT_RECALL_KEYWORD_PATTERNS } = await import("@/config/defaults");
    const parsed = SupermemoryConfigSchema.parse({});
    expect(parsed.recallKeywordPatterns).toEqual([...DEFAULT_RECALL_KEYWORD_PATTERNS]);
  });

  it("dedupEnabled defaults to true", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).dedupEnabled).toBe(true);
  });

  it("dedupCacheSize defaults to 500", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).dedupCacheSize).toBe(500);
  });

  it("entityContext defaults to DEFAULT_ENTITY_CONTEXT", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    const { DEFAULT_ENTITY_CONTEXT } = await import("@/config/defaults");
    expect(SupermemoryConfigSchema.parse({}).entityContext).toBe(DEFAULT_ENTITY_CONTEXT);
  });

  it("metadataStripping defaults to true", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).metadataStripping).toBe(true);
  });

  it("relativeTimeDisplay defaults to true", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).relativeTimeDisplay).toBe(true);
  });

  it("memoUsageFooter defaults to true", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).memoUsageFooter).toBe(true);
  });

  it("profileCrossArrayDedup defaults to true", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).profileCrossArrayDedup).toBe(true);
  });
});

describe("SupermemoryConfigSchema — 3 costly-off defaults applied on empty input", () => {
  it("everyMessageRecall defaults to false (costly)", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).everyMessageRecall).toBe(false);
  });

  it("reinjectEveryN defaults to 0 (disabled)", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).reinjectEveryN).toBe(0);
  });

  it("autoCategoryTagging defaults to false (costly)", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    expect(SupermemoryConfigSchema.parse({}).autoCategoryTagging).toBe(false);
  });
});

describe("silent-recovery — malformed values for every new key fall back to default", () => {
  it("every new key recovers from a wrong-type value via .catch()", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    const { DEFAULT_SIGNAL_KEYWORDS, DEFAULT_RECALL_KEYWORD_PATTERNS, DEFAULT_ENTITY_CONTEXT } = await import("@/config/defaults");

    // Each field receives a value of the wrong shape. .catch() must
    // absorb the failure and return the documented default.
    const result = SupermemoryConfigSchema.parse({
      incrementalCapture: "yes",
      maxCaptureChars: "five thousand",
      postCompactionReinject: 0,
      sessionEndSave: null,
      signalExtraction: 1,
      signalKeywords: "not-an-array",
      signalTurnsBefore: "three",
      recallKeywordPatterns: 42,
      dedupEnabled: "true",
      dedupCacheSize: { nested: true },
      entityContext: 9001,
      metadataStripping: [],
      relativeTimeDisplay: 0,
      memoUsageFooter: "no",
      profileCrossArrayDedup: undefined,
      everyMessageRecall: "true",
      reinjectEveryN: "five",
      autoCategoryTagging: "yes",
    });

    expect(result.incrementalCapture).toBe(true);
    expect(result.maxCaptureChars).toBe(5000);
    expect(result.postCompactionReinject).toBe(true);
    expect(result.sessionEndSave).toBe(true);
    expect(result.signalExtraction).toBe(true);
    expect(result.signalKeywords).toEqual([...DEFAULT_SIGNAL_KEYWORDS]);
    expect(result.signalTurnsBefore).toBe(3);
    expect(result.recallKeywordPatterns).toEqual([...DEFAULT_RECALL_KEYWORD_PATTERNS]);
    expect(result.dedupEnabled).toBe(true);
    expect(result.dedupCacheSize).toBe(500);
    expect(result.entityContext).toBe(DEFAULT_ENTITY_CONTEXT);
    expect(result.metadataStripping).toBe(true);
    expect(result.relativeTimeDisplay).toBe(true);
    expect(result.memoUsageFooter).toBe(true);
    expect(result.profileCrossArrayDedup).toBe(true);
    expect(result.everyMessageRecall).toBe(false);
    expect(result.reinjectEveryN).toBe(0);
    expect(result.autoCategoryTagging).toBe(false);
  });

  it("valid user-supplied values flow through verbatim (no override)", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    const result = SupermemoryConfigSchema.parse({
      incrementalCapture: false,
      maxCaptureChars: 8000,
      postCompactionReinject: false,
      sessionEndSave: false,
      signalExtraction: false,
      signalKeywords: ["custom", "keywords"],
      signalTurnsBefore: 5,
      recallKeywordPatterns: ["recall this"],
      dedupEnabled: false,
      dedupCacheSize: 100,
      entityContext: "Custom override context",
      metadataStripping: false,
      relativeTimeDisplay: false,
      memoUsageFooter: false,
      profileCrossArrayDedup: false,
      everyMessageRecall: true,
      reinjectEveryN: 10,
      autoCategoryTagging: true,
    });

    expect(result.incrementalCapture).toBe(false);
    expect(result.maxCaptureChars).toBe(8000);
    expect(result.postCompactionReinject).toBe(false);
    expect(result.sessionEndSave).toBe(false);
    expect(result.signalExtraction).toBe(false);
    expect(result.signalKeywords).toEqual(["custom", "keywords"]);
    expect(result.signalTurnsBefore).toBe(5);
    expect(result.recallKeywordPatterns).toEqual(["recall this"]);
    expect(result.dedupEnabled).toBe(false);
    expect(result.dedupCacheSize).toBe(100);
    expect(result.entityContext).toBe("Custom override context");
    expect(result.metadataStripping).toBe(false);
    expect(result.relativeTimeDisplay).toBe(false);
    expect(result.memoUsageFooter).toBe(false);
    expect(result.profileCrossArrayDedup).toBe(false);
    expect(result.everyMessageRecall).toBe(true);
    expect(result.reinjectEveryN).toBe(10);
    expect(result.autoCategoryTagging).toBe(true);
  });
});

describe("SupermemoryConfig type — 13 existing keys preserved alongside 18 new keys", () => {
  it("parse({}) returns the union of all 13 existing defaults plus all 18 new defaults", async () => {
    const { SupermemoryConfigSchema } = await import("@/config/schema");
    const result = SupermemoryConfigSchema.parse({});

    // Existing 13 keys preserved (regression guard).
    expect(result.apiKey).toBeUndefined();
    expect(result.similarityThreshold).toBe(0.6);
    expect(result.maxMemories).toBe(5);
    expect(result.maxProjectMemories).toBe(10);
    expect(result.maxProfileItems).toBe(5);
    expect(result.injectProfile).toBe(true);
    expect(result.containerTagPrefix).toBe("opencode");
    expect(result.projectTagStrategy).toBe("hashGitRepoName");
    expect(result.userContainerTag).toBeUndefined();
    expect(result.projectContainerTag).toBeUndefined();
    expect(result.filterPrompt).toContain("You are a stateful coding agent");
    expect(result.keywordPatterns).toEqual([]);
    expect(result.compactionThreshold).toBe(0.8);

    // 18 new keys present on the resolved type.
    const newKeys = [
      "incrementalCapture",
      "maxCaptureChars",
      "postCompactionReinject",
      "sessionEndSave",
      "signalExtraction",
      "signalKeywords",
      "signalTurnsBefore",
      "recallKeywordPatterns",
      "dedupEnabled",
      "dedupCacheSize",
      "entityContext",
      "metadataStripping",
      "relativeTimeDisplay",
      "memoUsageFooter",
      "profileCrossArrayDedup",
      "everyMessageRecall",
      "reinjectEveryN",
      "autoCategoryTagging",
    ] as const;
    for (const key of newKeys) {
      expect(result).toHaveProperty(key);
    }
  });
});
