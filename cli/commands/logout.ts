import { defineCommand } from "citty";

import { clearCredentials } from "@/auth/credentials";

export default defineCommand({
  meta: { name: "logout", description: "Clear stored credentials" },
  run() {
    if (clearCredentials()) {
      console.log("✓ Logged out. Credentials cleared.");
    } else {
      console.log("No credentials found.");
    }
    process.exit(0);
  },
});
