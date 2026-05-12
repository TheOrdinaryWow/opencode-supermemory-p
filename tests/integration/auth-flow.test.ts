import { describe, expect, it } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

interface AuthEvalResult {
  result?: { success: boolean; apiKey?: string; error?: string };
  credentials?: { apiKey: string; createdAt: string };
  fileMode?: number;
  dirMode?: number;
  listenPort?: number;
  response?: { status?: number; body?: string };
  closed?: number;
  existedAfter?: boolean;
  error?: string;
}

async function runAuthScenario(scenario: string): Promise<AuthEvalResult> {
  const tmpHome = createTmpDir(`auth-${scenario}`);
  try {
    const script = `
      import { mkdirSync, statSync, writeFileSync, existsSync } from "node:fs";
      import { join } from "node:path";
      import { clearCredentials, loadCredentials, saveCredentials } from ${JSON.stringify(join(REPO_ROOT, "src", "auth", "credentials.ts"))};
      import { startAuthFlow } from ${JSON.stringify(join(REPO_ROOT, "src", "auth", "flow.ts"))};

      const response = {};
      const scenario = ${JSON.stringify(scenario)};
      const serverState = { closed: 0 };
      const credentialsFile = join(process.env.HOME, ".supermemory-opencode", "credentials.json");
      const credentialsDir = join(process.env.HOME, ".supermemory-opencode");
      const serverFactory = (options) => ({
        start() {
          serverState.listenPort = options.port;
          if (scenario === "port-conflict") {
            options.onError(\`Port \${options.port} is already in use\`);
            return;
          }
          if (scenario === "callback") {
            saveCredentials("sm_test123");
            response.status = 200;
            response.body = "Connected!";
            serverState.closed = 1;
            options.onApiKey("sm_test123");
            return;
          }
          setTimeout(() => {
            serverState.closed = 1;
            options.onError("Authentication timed out");
          }, options.timeoutMs);
        },
        stop() { serverState.closed += 1; },
      });

      if (scenario === "callback") {
        const result = await startAuthFlow({ timeoutMs: 25, openBrowser() {}, serverFactory });
        const fileMode = statSync(credentialsFile).mode & 0o777;
        const dirMode = statSync(credentialsDir).mode & 0o777;
        process.stdout.write("__RESULT__" + JSON.stringify({ result, credentials: loadCredentials(), fileMode, dirMode, listenPort: serverState.listenPort, response, closed: serverState.closed }));
      }

      if (scenario === "port-conflict") {
        const result = await startAuthFlow({ timeoutMs: 5, openBrowser() {}, serverFactory });
        await new Promise((resolve) => setTimeout(resolve, 10));
        process.stdout.write("__RESULT__" + JSON.stringify({ result, listenPort: serverState.listenPort, closed: serverState.closed }));
      }

      if (scenario === "timeout") {
        const result = await startAuthFlow({ timeoutMs: 5, openBrowser() {}, serverFactory });
        process.stdout.write("__RESULT__" + JSON.stringify({ result, listenPort: serverState.listenPort, closed: serverState.closed }));
      }

      if (scenario === "clear") {
        mkdirSync(credentialsDir, { recursive: true });
        writeFileSync(credentialsFile, JSON.stringify({ apiKey: "sm_test_clear", createdAt: "2026-01-01T00:00:00.000Z" }));
        const result = clearCredentials();
        process.stdout.write("__RESULT__" + JSON.stringify({ result: { success: result }, existedAfter: existsSync(credentialsFile) }));
      }
    `;
    const proc = Bun.spawn(["bun", "-e", script], {
      cwd: REPO_ROOT,
      env: { ...(process.env as Record<string, string>), HOME: tmpHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    if (proc.exitCode !== 0) {
      throw new Error(`auth scenario ${scenario} exited ${proc.exitCode}\nstderr:\n${stderr}\nstdout:\n${stdout}`);
    }
    const marker = "__RESULT__";
    const index = stdout.lastIndexOf(marker);
    if (index === -1) throw new Error(`auth scenario ${scenario} produced no result marker\nstdout:\n${stdout}`);
    return JSON.parse(stdout.slice(index + marker.length)) as AuthEvalResult;
  } finally {
    cleanupTmpDir(tmpHome);
  }
}

describe("auth flow", () => {
  it("writes credentials when the OAuth callback supplies an API key", async () => {
    const res = await runAuthScenario("callback");

    expect(res.result).toEqual({ success: true, apiKey: "sm_test123" });
    expect(res.credentials?.apiKey).toBe("sm_test123");
    expect(typeof res.credentials?.createdAt).toBe("string");
    expect(res.fileMode).toBe(0o600);
    expect(res.dirMode).toBe(0o700);
    expect(res.listenPort).toBe(19877);
    expect(res.response?.status).toBe(200);
  });

  it("returns a clear error when the OAuth callback port is already in use", async () => {
    const res = await runAuthScenario("port-conflict");

    expect(res.result).toEqual({ success: false, error: "Port 19877 is already in use" });
    expect(res.listenPort).toBe(19877);
  });

  it("closes the server and returns a timeout result when auth never calls back", async () => {
    const res = await runAuthScenario("timeout");

    expect(res.result).toEqual({ success: false, error: "Authentication timed out" });
    expect(res.closed).toBe(1);
  });

  it("clearCredentials removes the saved credentials file", async () => {
    const res = await runAuthScenario("clear");

    expect(res.result).toEqual({ success: true });
    expect(res.existedAfter).toBe(false);
  });
});
