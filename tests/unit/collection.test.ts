import { describe, expect, it } from "bun:test";

import { dedupe } from "../../src/shared/collection";

describe("dedupe", () => {
  it("returns the same items for unique values", () => {
    expect(dedupe(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("deduplicates values using a case-insensitive normalized key", () => {
    expect(dedupe(["Alpha", "alpha", "BETA", "beta"])).toEqual(["Alpha", "BETA"]);
  });

  it("skips empty and whitespace-only keys", () => {
    expect(dedupe(["", "   ", "alpha", " ", "beta"])).toEqual(["alpha", "beta"]);
  });

  it("supports a custom key function", () => {
    const items = [{ id: "A1" }, { id: "a1" }, { id: "B2" }];

    expect(dedupe(items, (item: { id: string }) => item.id)).toEqual([{ id: "A1" }, { id: "B2" }]);
  });

  it("preserves the first seen order", () => {
    expect(dedupe(["b", "A", "a", "B", "c"])).toEqual(["b", "A", "c"]);
  });
});
