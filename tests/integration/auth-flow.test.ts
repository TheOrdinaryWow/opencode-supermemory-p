import { describe, expect, it } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanupTmpDir, createTmpDir } from "../helpers/tmpdir.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const AUTH_SRC = join(REPO_ROOT, "src", "services", "auth.ts");

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
      import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";

      const response = {};
      const scenario = ${JSON.stringify(scenario)};
      const source = readFileSync(${JSON.stringify(AUTH_SRC)}, "utf-8")
        .replace('import { exec } from "node:child_process";', 'import { exec } from "./mock-child-process.ts";')
        .replace('import { createServer, type IncomingMessage, type ServerResponse } from "node:http";', 'import { createServer, type IncomingMessage, type ServerResponse, serverState } from "./mock-http.ts";');

      const mockHttpPath = join(process.env.HOME, "mock-http.ts");
      writeFileSync(mockHttpPath, \`
        export type IncomingMessage = { url?: string };
        export type ServerResponse = { writeHead(status: number, headers?: Record<string, string>): void; end(body?: string): void };
        type Handler = (req: IncomingMessage, res: ServerResponse) => void;
        export const serverState: { handler?: Handler; errorHandler?: (err: Error & { code?: string }) => void; listenPort?: number; closed: number } = { closed: 0 };
        export function createServer(handler: Handler) {
          serverState.handler = handler;
          const server = {
            on(event: string, cb: (err: Error & { code?: string }) => void) {
              if (event === "error") serverState.errorHandler = cb;
              return server;
            },
            listen(port: number, cb: () => void) {
              serverState.listenPort = port;
              if (${JSON.stringify(scenario)} === "port-conflict") {
                serverState.errorHandler?.(Object.assign(new Error("in use"), { code: "EADDRINUSE" }));
                return server;
              }
              cb?.();
              return server;
            },
            close() {
              serverState.closed += 1;
            },
          };
          return server;
        }
      \`);
      writeFileSync(join(process.env.HOME, "mock-child-process.ts"), 'export function exec(_cmd: string, cb?: (err: Error | null) => void) { cb?.(null); }');
      const authPath = join(process.env.HOME, "auth-under-test.ts");
      writeFileSync(authPath, source);

      const auth = await import(pathToFileURL(authPath).href);
      const { serverState } = await import(pathToFileURL(mockHttpPath).href);
      const credentialsFile = join(process.env.HOME, ".supermemory-opencode", "credentials.json");
      const credentialsDir = join(process.env.HOME, ".supermemory-opencode");

      if (scenario === "callback") {
        const flow = auth.startAuthFlow(25);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const res = {
          writeHead(status) { response.status = status; },
          end(body) { response.body = String(body); },
        };
        serverState.handler({ url: "/callback?apikey=sm_test123" }, res);
        const result = await flow;
        await new Promise((resolve) => setTimeout(resolve, 30));
        const fileMode = statSync(credentialsFile).mode & 0o777;
        const dirMode = statSync(credentialsDir).mode & 0o777;
        process.stdout.write("__RESULT__" + JSON.stringify({ result, credentials: JSON.parse(readFileSync(credentialsFile, "utf-8")), fileMode, dirMode, listenPort: serverState.listenPort, response, closed: serverState.closed }));
      }

      if (scenario === "port-conflict") {
        const result = await auth.startAuthFlow(5);
        await new Promise((resolve) => setTimeout(resolve, 10));
        process.stdout.write("__RESULT__" + JSON.stringify({ result, listenPort: serverState.listenPort, closed: serverState.closed }));
      }

      if (scenario === "timeout") {
        const result = await auth.startAuthFlow(5);
        process.stdout.write("__RESULT__" + JSON.stringify({ result, listenPort: serverState.listenPort, closed: serverState.closed }));
      }

      if (scenario === "clear") {
        mkdirSync(credentialsDir, { recursive: true });
        writeFileSync(credentialsFile, JSON.stringify({ apiKey: "sm_test_clear", createdAt: "2026-01-01T00:00:00.000Z" }));
        const result = auth.clearCredentials();
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
