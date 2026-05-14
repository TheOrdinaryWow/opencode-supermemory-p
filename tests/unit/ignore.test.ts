import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { isProjectIgnored } from "@/config/ignore";

import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir";

describe("isProjectIgnored", () => {
  it("returns false when the directory does not contain .supermemoryignore", () => {
    const dir = createTmpDir("ignore-absent");
    try {
      expect(isProjectIgnored(dir)).toBe(false);
    } finally {
      cleanupTmpDir(dir);
    }
  });

  it("returns true when .supermemoryignore exists in the directory", () => {
    const dir = createTmpDir("ignore-present");
    try {
      writeFileSync(join(dir, ".supermemoryignore"), "");
      expect(isProjectIgnored(dir)).toBe(true);
    } finally {
      cleanupTmpDir(dir);
    }
  });

  it("treats a non-empty .supermemoryignore the same as an empty one (presence-only check)", () => {
    const dir = createTmpDir("ignore-nonempty");
    try {
      writeFileSync(join(dir, ".supermemoryignore"), "node_modules\n");
      expect(isProjectIgnored(dir)).toBe(true);
    } finally {
      cleanupTmpDir(dir);
    }
  });

  it("returns false for a non-existent directory rather than throwing", () => {
    expect(isProjectIgnored("/tmp/this-path-does-not-exist-xyz-omsm")).toBe(false);
  });

  it("returns false when the path is empty", () => {
    expect(isProjectIgnored("")).toBe(false);
  });
});
