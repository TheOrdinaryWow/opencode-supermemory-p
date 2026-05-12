import { defineConfig } from "tsdown";

const external = ["@opencode-ai/plugin", "supermemory"];
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
      neverBundle: external,
    },
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    platform: "node",
    target: "node18",
    dts: false,
    outExtensions,
    deps: {
      neverBundle: external,
    },
  },
]);
