import { describe, expect, it } from "bun:test";

import { formatMemoFooter } from "@/memory/footer";

describe("formatMemoFooter", () => {
  it("renders the total across profile, project, and relevant counts", () => {
    expect(
      formatMemoFooter({
        profile: 1,
        projectMemories: 2,
        relevantMemories: 2,
      }),
    ).toBe("[Supermemory: 5 memories loaded]");
  });

  it("returns an empty string when no memories are loaded", () => {
    expect(
      formatMemoFooter({
        profile: 0,
        projectMemories: 0,
        relevantMemories: 0,
      }),
    ).toBe("");
  });

  it("handles mixed non-zero counts with one bucket empty", () => {
    expect(
      formatMemoFooter({
        profile: 3,
        projectMemories: 0,
        relevantMemories: 7,
      }),
    ).toBe("[Supermemory: 10 memories loaded]");
  });
});
