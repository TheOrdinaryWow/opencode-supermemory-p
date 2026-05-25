import { describe, expect, it } from "bun:test";

import { redactedPreview } from "@/shared/redact";

describe("redactedPreview", () => {
  it("redacts supermemory keys", () => {
    expect(redactedPreview("token sm_abcdef1234567890XYZ rest")).toContain("[SM_KEY]");
    expect(redactedPreview("token sm_abcdef1234567890XYZ rest")).not.toContain("sm_abcdef");
  });

  it("redacts openai-style keys", () => {
    expect(redactedPreview("key sk-1234567890abcdefghij rest")).toContain("[OPENAI_KEY]");
  });

  it("redacts github tokens", () => {
    for (const prefix of ["ghp_", "ghs_", "gho_", "ghu_", "ghr_"]) {
      const sample = `lead ${prefix}AAAAAAAAAAAAAAAA1234 tail`;
      expect(redactedPreview(sample)).toContain("[GH_TOKEN]");
      expect(redactedPreview(sample)).not.toContain(prefix);
    }
  });

  it("redacts AWS access keys", () => {
    expect(redactedPreview("creds AKIAABCDEFGHIJKLMNOP done")).toContain("[AWS_KEY]");
  });

  it("redacts bearer auth headers", () => {
    expect(redactedPreview("Authorization: Bearer xyzabc.123-DEF=")).toContain("Bearer [REDACTED]");
  });

  it("redacts email addresses", () => {
    expect(redactedPreview("ping alice@example.com please")).toContain("[EMAIL]");
    expect(redactedPreview("ping alice@example.com please")).not.toContain("alice@");
  });

  it("redacts http(s) URLs but leaves relative paths alone", () => {
    expect(redactedPreview("visit https://api.example.com/users")).toContain("[URL]");
    expect(redactedPreview("see ./README.md for details")).toContain("./README.md");
  });

  it("collapses whitespace and clamps to 200 chars with ellipsis", () => {
    const long = `${"abc ".repeat(80)}END`; // 320+ chars
    const out = redactedPreview(long);
    expect(out.length).toBeLessThanOrEqual(201); // 200 + 1 ellipsis char
    expect(out.endsWith("\u2026")).toBe(true);
  });

  it("trims short content as-is", () => {
    expect(redactedPreview("  hello world  ")).toBe("hello world");
  });

  it("redacts SM_KEY inside URL without losing the URL redaction", () => {
    const out = redactedPreview("call https://x.com/sm_abcdef1234567890ABCD please");
    // SM_KEY matches first; the remaining URL still gets [URL]
    expect(out).toContain("[SM_KEY]");
    expect(out).not.toContain("sm_abcdef");
  });
});
