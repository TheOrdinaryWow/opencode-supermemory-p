import { defineCommand } from "citty";

import pkg from "../../package.json" with { type: "json" };

export const VERSION = pkg.version;
export const PACKAGE_NAME = pkg.name;

export default defineCommand({
  meta: { name: "version", description: "Show the installed version" },
  run() {
    console.log(`${PACKAGE_NAME} ${VERSION}`);
    process.exit(0);
  },
});
