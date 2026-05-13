/**
 * Regenerate schema.json from the Zod source of truth (src/config/schema.ts).
 *
 * Zod is the single source of truth for the resolved plugin configuration.
 * This script projects it into a JSON Schema so editors (VSCode, Cursor) can
 * provide completion and inline validation when users reference it via the
 * `$schema` field in `~/.config/opencode/supermemory-p.jsonc`.
 *
 * Runtime semantics are fail-soft: every field with a `.catch(default)` clause
 * is silently coerced on invalid input. The generated schema therefore marks
 * `required: []` — nothing is strictly required at the editor level either.
 */
import { writeFileSync } from "node:fs";

import { z } from "zod";

import { SupermemoryConfigSchema } from "../src/config/schema";

const generated = z.toJSONSchema(SupermemoryConfigSchema, {
  target: "draft-2020-12",
});

const schema = {
  $id: "https://raw.githubusercontent.com/TheOrdinaryWow/opencode-supermemory-p/main/schema.json",
  title: "opencode-supermemory-p config",
  description: "Configuration for opencode-supermemory-p.",
  ...generated,
  required: [],
};

const out = `${JSON.stringify(schema, null, 2)}\n`;
writeFileSync(new URL("../assets/config.schema.json", import.meta.url), out);
console.log("✓ schema.json regenerated");
