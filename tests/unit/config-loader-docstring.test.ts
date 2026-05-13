import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = join(HERE, "..", "..");
const LOADER_PATH = join(REPO_ROOT, "src", "config", "loader.ts");

function getLoadConfigDocstring(source: string): string {
  const match = source.match(/\/\*\*[\s\S]*?Loads, validates, and returns the resolved Supermemory configuration\.[\s\S]*?\*\//);
  if (!match) throw new Error("loadConfig docstring not found");
  return match[0];
}

describe("loadConfig docstring", () => {
  it("documents the actual two-tier lookup without legacy bare-name wording", () => {
    const source = readFileSync(LOADER_PATH, "utf-8");
    const docstring = getLoadConfigDocstring(source);

    expect(docstring).toContain("SUPERMEMORY_API_KEY");
    expect(docstring).toContain("~/.config/opencode/supermemory-p.{jsonc,json}");
    expect(docstring).toContain("~/.local/share/opencode-supermemory-p/credentials.json");
    expect(docstring).not.toContain("supermemory.{jsonc,json}");
    expect(docstring).not.toContain("supermemory.jsonc");
  });
});
