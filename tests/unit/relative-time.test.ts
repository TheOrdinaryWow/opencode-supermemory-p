import { describe, expect, it } from "bun:test";

import { formatRelativeTime } from "../../src/memory/relative-time";

describe("formatRelativeTime", () => {
  const now = new Date("2026-05-15T12:00:00.000Z");

  it("returns just now for times under 30 minutes", () => {
    expect(formatRelativeTime("2026-05-15T11:31:00.000Z", now)).toBe("just now");
  });

  it("formats 45 minutes as mins ago", () => {
    expect(formatRelativeTime("2026-05-15T11:15:00.000Z", now)).toBe("45mins ago");
  });

  it("formats one hour as singular hr ago", () => {
    expect(formatRelativeTime("2026-05-15T11:00:00.000Z", now)).toBe("1 hr ago");
  });

  it("formats six hours as hrs ago", () => {
    expect(formatRelativeTime("2026-05-15T06:00:00.000Z", now)).toBe("6 hrs ago");
  });

  it("formats three days as d ago", () => {
    expect(formatRelativeTime("2026-05-12T12:00:00.000Z", now)).toBe("3d ago");
  });

  it("formats same-year dates with month abbreviation", () => {
    expect(formatRelativeTime("2026-08-15T00:00:00.000Z", now)).toBe("15 Aug");
  });

  it("formats different-year dates with year suffix", () => {
    expect(formatRelativeTime("2023-08-22T00:00:00.000Z", now)).toBe("22 Aug, 2023");
  });

  it("returns an empty string for invalid input", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("");
  });
});
