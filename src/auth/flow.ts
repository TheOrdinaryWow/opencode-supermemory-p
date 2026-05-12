import { exec } from "node:child_process";

import { createCallbackServer } from "@/auth/callback-server";
import { saveCredentials } from "@/auth/credentials";

export const AUTH_PORT = 19877;
const AUTH_CALLBACK_PATH = "/callback";
const AUTH_BASE_URL = process.env.SUPERMEMORY_AUTH_URL || "https://app.supermemory.ai/auth/connect";
const CLIENT_NAME = "opencode";

export interface AuthResult {
  success: boolean;
  apiKey?: string;
  error?: string;
}

export interface AuthFlowOptions {
  port?: number;
  timeoutMs?: number;
  openBrowser?: (url: string) => void;
  serverFactory?: typeof createCallbackServer;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const commands: Record<string, string> = {
    darwin: `open "${url}"`,
    win32: `start "" "${url}"`,
    linux: `xdg-open "${url}"`,
  };
  const cmd = commands[platform] ?? `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.error("Failed to open browser:", err.message);
  });
}

export function startAuthFlow(optionsOrTimeoutMs: AuthFlowOptions | number = {}): Promise<AuthResult> {
  const options = typeof optionsOrTimeoutMs === "number" ? { timeoutMs: optionsOrTimeoutMs } : optionsOrTimeoutMs;
  const port = options.port ?? AUTH_PORT;
  const timeoutMs = options.timeoutMs ?? 120000;
  const launchBrowser = options.openBrowser ?? openBrowser;
  const serverFactory = options.serverFactory ?? createCallbackServer;

  return new Promise((resolve) => {
    const server = serverFactory({
      port,
      timeoutMs,
      onApiKey(apiKey) {
        saveCredentials(apiKey);
        resolve({ success: true, apiKey });
      },
      onError(error) {
        resolve({ success: false, error });
      },
    });
    server.start(() => {
      const callbackUrl = `http://localhost:${port}${AUTH_CALLBACK_PATH}`;
      const authUrl = `${AUTH_BASE_URL}?callback=${encodeURIComponent(callbackUrl)}&client=${CLIENT_NAME}`;
      console.log("Opening browser for authentication...");
      console.log(`If it doesn't open, visit: ${authUrl}`);
      launchBrowser(authUrl);
    });
  });
}
