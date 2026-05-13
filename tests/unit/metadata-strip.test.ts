import { describe, expect, it } from "bun:test";

import { stripInboundMetadata } from "@/memory/metadata-strip";

describe("stripInboundMetadata", () => {
  it("strips leading ISO timestamp", () => {
    expect(stripInboundMetadata("[2024-01-01T00:00:00.123Z] hello")).toBe("hello");
    expect(stripInboundMetadata("2024-01-01 00:00:00 hello")).toBe("hello");
  });

  it("strips single-line system reminder tag", () => {
    expect(stripInboundMetadata("<system-reminder>noise</system-reminder>\nhello")).toBe("hello");
  });

  it("strips multi-line supermemory context tag", () => {
    const input = "before\n<supermemory-context>\none\ntwo\n</supermemory-context>\nafter";

    expect(stripInboundMetadata(input)).toBe("before\n\nafter");
  });

  it("strips supermemory containers tag", () => {
    const input = '<supermemory-containers>{"id":"1"}</supermemory-containers>\nhello';

    expect(stripInboundMetadata(input)).toBe("hello");
  });

  it("strips sentinel line and following fenced JSON block", () => {
    const input = [
      "Conversation info (untrusted metadata):",
      "```json",
      '{"id":"abc","createdAt":"2024-01-01T00:00:00Z"}',
      "```",
      "real content",
    ].join("\n");

    expect(stripInboundMetadata(input)).toBe("real content");
  });

  it("keeps only real content from mixed metadata", () => {
    const input = "2024-01-01T00:00:00Z\n<system-reminder>X</system-reminder>\n<supermemory-context>Y</supermemory-context>\nhello";

    expect(stripInboundMetadata(input)).toBe("hello");
  });

  it("is idempotent", () => {
    const input = [
      "[2024-01-01T00:00:00Z]",
      "Sender (untrusted metadata):",
      "```json",
      '{"name":"bot"}',
      "```",
      "<system-reminder>ignore</system-reminder>",
      "hello",
    ].join("\n");
    const once = stripInboundMetadata(input);

    expect(stripInboundMetadata(once)).toBe(once);
  });

  it("returns empty string for empty, null, or undefined input", () => {
    expect(stripInboundMetadata("")).toBe("");
    expect(stripInboundMetadata(null as unknown as string)).toBe("");
    expect(stripInboundMetadata(undefined as unknown as string)).toBe("");
  });
});
