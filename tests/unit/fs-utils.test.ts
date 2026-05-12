import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ensureDir, readJsoncFile, readJsonFile, writeJsoncFile, writeJsonFile } from "../../src/shared/fs-utils.ts";
import { useTmpDir } from "../helpers/tmpdir.ts";

describe("readJsoncFile", () => {
  const dir = useTmpDir("fs-utils-readJsonc");

  it("strips // and /* */ comments before parsing", () => {
    const path = join(dir, "config.jsonc");
    writeFileSync(path, '// header\n{\n  "key": "value", /* mid */\n  "n": 1\n}\n');
    const parsed = readJsoncFile<{ key: string; n: number }>(path);
    expect(parsed).toEqual({ key: "value", n: 1 });
  });

  it("tolerates trailing commas (matches stripJsoncComments)", () => {
    const path = join(dir, "trailing.jsonc");
    writeFileSync(path, '{\n  "list": [1, 2, 3,],\n}\n');
    expect(readJsoncFile<{ list: number[] }>(path)).toEqual({ list: [1, 2, 3] });
  });

  it("throws ENOENT when the file is missing", () => {
    expect(() => readJsoncFile(join(dir, "missing.jsonc"))).toThrow(/ENOENT/);
  });
});

describe("writeJsoncFile", () => {
  const dir = useTmpDir("fs-utils-writeJsonc");

  it("writes pretty-printed JSON (default 2-space indent) and round-trips", () => {
    const path = join(dir, "out.jsonc");
    writeJsoncFile(path, { a: 1, b: [2, 3] });
    expect(readFileSync(path, "utf-8")).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
    expect(readJsoncFile<{ a: number; b: number[] }>(path)).toEqual({ a: 1, b: [2, 3] });
  });

  it("honours opts.space (e.g. tab indentation)", () => {
    const path = join(dir, "tabbed.jsonc");
    writeJsoncFile(path, { x: 1 }, { space: "\t" });
    expect(readFileSync(path, "utf-8")).toBe('{\n\t"x": 1\n}');
  });

  it("applies opts.mode via chmod after write", () => {
    const path = join(dir, "secret.jsonc");
    writeJsoncFile(path, { token: "abc" }, { mode: 0o600 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe("readJsonFile", () => {
  const dir = useTmpDir("fs-utils-readJson");

  it("parses plain JSON without comment stripping", () => {
    const path = join(dir, "data.json");
    writeFileSync(path, '{"x":42}');
    expect(readJsonFile<{ x: number }>(path)).toEqual({ x: 42 });
  });

  it("does NOT strip JSONC comments — strict JSON only", () => {
    const path = join(dir, "with-comment.json");
    writeFileSync(path, '// comment\n{"x":1}');
    // readJsonFile must throw, since the leading `//` is not valid JSON.
    expect(() => readJsonFile(path)).toThrow();
  });
});

describe("writeJsonFile", () => {
  const dir = useTmpDir("fs-utils-writeJson");

  it("writes pretty-printed JSON with default 2-space indent", () => {
    const path = join(dir, "out.json");
    writeJsonFile(path, { foo: "bar" });
    expect(readFileSync(path, "utf-8")).toBe('{\n  "foo": "bar"\n}');
  });

  it("applies opts.mode via chmod after write", () => {
    const path = join(dir, "creds.json");
    writeJsonFile(path, { apiKey: "sm_x" }, { mode: 0o600 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe("ensureDir", () => {
  const dir = useTmpDir("fs-utils-ensureDir");

  it("creates a deeply nested directory tree (recursive mkdir)", () => {
    const target = join(dir, "a", "b", "c");
    ensureDir(target);
    expect(existsSync(target)).toBe(true);
  });

  it("is a no-op when the directory already exists", () => {
    const target = join(dir, "existing");
    ensureDir(target);
    expect(() => ensureDir(target)).not.toThrow();
    expect(existsSync(target)).toBe(true);
  });

  it("applies the mode argument via chmod", () => {
    const target = join(dir, "private-dir");
    ensureDir(target, 0o700);
    expect(statSync(target).mode & 0o777).toBe(0o700);
  });
});
