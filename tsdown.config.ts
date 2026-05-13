import { defineConfig, type TsdownHooks } from "tsdown";

const outExtensions = () => ({ js: ".js", dts: ".d.ts" });

const defaultExportSyntaxPlugin = {
  name: "default-export-syntax",
  renderChunk(code: string, chunk: { fileName: string }) {
    if (chunk.fileName !== "index.js") return null;
    return code.replace(
      "export { SupermemoryPlugin, SupermemoryPlugin as default };",
      "export { SupermemoryPlugin };\nexport default SupermemoryPlugin;",
    );
  },
};

const copyTemplatesHook: TsdownHooks["build:done"] = async ({ options: { outDir } }) => {
  const fs = await import("fs-extra");
  const path = await import("node:path");

  const templateSrc = path.resolve(import.meta.dirname, "cli/templates");
  const templateDest = path.resolve(outDir, "templates");

  await fs.copy(templateSrc, templateDest);
};

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    platform: "node",
    target: "node18",
    dts: true,
    clean: true,
    outExtensions,
    plugins: [defaultExportSyntaxPlugin],
    deps: {
      neverBundle: ["@opencode-ai/plugin", "supermemory", "citty"],
    },
  },
  {
    entry: { cli: "cli/index.ts" },
    format: ["esm"],
    platform: "node",
    target: "node18",
    dts: false,
    outExtensions,
    deps: {
      neverBundle: ["@opencode-ai/plugin", "supermemory"],
      alwaysBundle: [/^(citty|fs-extra|jsonc-parser|zod)(\/.*)?$/],
      onlyBundle: false,
    },
    hooks: {
      "build:done": copyTemplatesHook,
    },
  },
]);
