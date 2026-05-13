import { describe, expect, it } from "bun:test";

import { type Category, detectCategory } from "@/memory/category";

describe("detectCategory", () => {
  it("classifies a preference phrase as 'preference'", () => {
    expect(detectCategory("I prefer dark mode for the editor")).toBe<Category>("preference");
  });

  it("classifies a decision phrase as 'decision'", () => {
    expect(detectCategory("We decided to switch the build runner")).toBe<Category>("decision");
  });

  it("classifies an entity phrase as 'entity'", () => {
    expect(detectCategory("My team is Platform Infra")).toBe<Category>("entity");
  });

  it("classifies a plain factual phrase as 'fact'", () => {
    expect(detectCategory("The sky is blue today")).toBe<Category>("fact");
  });

  it("returns 'other' for empty input", () => {
    expect(detectCategory("")).toBe<Category>("other");
  });

  it("strips fenced code blocks before matching so code does not trigger preference", () => {
    const input = "```ts\nI prefer dark mode\n```\nshipping update";
    expect(detectCategory(input)).toBe<Category>("other");
  });

  it("returns 'other' for null or undefined input without throwing", () => {
    expect(detectCategory(null as unknown as string)).toBe<Category>("other");
    expect(detectCategory(undefined as unknown as string)).toBe<Category>("other");
  });

  it("prefers 'preference' over 'fact' when both signals are present", () => {
    expect(detectCategory("I prefer the way the API is structured")).toBe<Category>("preference");
  });
});
