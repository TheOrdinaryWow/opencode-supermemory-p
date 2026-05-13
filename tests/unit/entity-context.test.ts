import { describe, expect, it } from "bun:test";

import { clampEntityContext, DEFAULT_ENTITY_CONTEXT, MAX_ENTITY_CONTEXT_LENGTH } from "../../src/memory/entity-context";

describe("entity-context", () => {
  it("keeps DEFAULT_ENTITY_CONTEXT within the configured limit", () => {
    expect(DEFAULT_ENTITY_CONTEXT.length <= MAX_ENTITY_CONTEXT_LENGTH).toBe(true);
  });

  it("clamps long text at a word boundary", () => {
    const word = "memory";
    const text = Array.from({ length: 228 }, () => word).join(" ");

    const clamped = clampEntityContext(text);

    expect(clamped.length <= MAX_ENTITY_CONTEXT_LENGTH).toBe(true);
    expect(clamped.length).toBeLessThan(text.length);
    expect(clamped.endsWith(" ")).toBe(false);
    expect(clamped.split(" ").at(-1)).toBe(word);
  });

  it("returns short text unchanged", () => {
    const text = "short entity context";

    expect(clampEntityContext(text)).toBe(text);
  });
});
