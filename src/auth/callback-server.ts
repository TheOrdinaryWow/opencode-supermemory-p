import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createFailurePage, createSuccessPage } from "@/auth/callback-pages";

export interface CallbackServerOptions {
  port: number;
  timeoutMs: number;
  onApiKey(apiKey: string): void;
  onError(error: string): void;
}

export interface CallbackServerHandle {
  start(onListening?: () => void): void;
  stop(): void;
}

export function createCallbackServer(options: CallbackServerOptions): CallbackServerHandle {
  let resolved = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (resolved) return;
    const url = new URL(req.url || "/", `http://localhost:${options.port}`);
    if (url.pathname !== "/callback") {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const apiKey = url.searchParams.get("apikey");
    if (apiKey) {
      finish();
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(createSuccessPage());
      options.onApiKey(apiKey);
      return;
    }
    finish();
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(createFailurePage());
    options.onError("No API key received");
  });

  function finish(): void {
    resolved = true;
    if (timeout) clearTimeout(timeout);
    server.close();
  }

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (resolved) return;
    resolved = true;
    if (timeout) clearTimeout(timeout);
    options.onError(err.code === "EADDRINUSE" ? `Port ${options.port} is already in use` : err.message);
  });

  return {
    start(onListening?: () => void) {
      server.listen(options.port, onListening);
      timeout = setTimeout(() => {
        if (resolved) return;
        finish();
        options.onError("Authentication timed out");
      }, options.timeoutMs);
    },
    stop() {
      if (!resolved) finish();
    },
  };
}
