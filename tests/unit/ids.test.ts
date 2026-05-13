import { describe, expect, it } from "bun:test";

import { generateMessageId, generatePartId } from "../../src/shared/ids";

/**
 * Canonical ID format:
 *   prefix `prt_` or `msg_` + hex timestamp + 8 chars of base36 randomness.
 *
 * The hex timestamp from `Date.now().toString(16)` is currently 11 chars at
 * millisecond resolution; do not hard-code the length, only its character class.
 * The random tail comes from `Math.random().toString(36).substring(2, 10)` and is
 * exactly 8 chars of `[0-9a-z]`.
 */
const PART_ID_PATTERN = /^prt_[0-9a-f]+[0-9a-z]{8}$/;
const MESSAGE_ID_PATTERN = /^msg_[0-9a-f]+[0-9a-z]{8}$/;

describe("generatePartId", () => {
  it("returns a string matching the canonical part ID format", () => {
    const id = generatePartId();

    expect(typeof id).toBe("string");
    expect(id.startsWith("prt_")).toBe(true);
    expect(PART_ID_PATTERN.test(id)).toBe(true);
  });

  it("returns a different value on each call", () => {
    const first = generatePartId();
    const second = generatePartId();

    expect(first).not.toBe(second);
  });
});

describe("generateMessageId", () => {
  it("returns a string matching the canonical message ID format", () => {
    const id = generateMessageId();

    expect(typeof id).toBe("string");
    expect(id.startsWith("msg_")).toBe(true);
    expect(MESSAGE_ID_PATTERN.test(id)).toBe(true);
  });

  it("returns a different value on each call", () => {
    const first = generateMessageId();
    const second = generateMessageId();

    expect(first).not.toBe(second);
  });

  it("never collides with part IDs (different prefix)", () => {
    const messageId = generateMessageId();
    const partId = generatePartId();

    expect(messageId.startsWith("msg_")).toBe(true);
    expect(partId.startsWith("prt_")).toBe(true);
    expect(messageId).not.toBe(partId);
  });
});
