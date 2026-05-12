import { mock } from "bun:test";

/**
 * Response shape for a registered command. Strings/Buffers are returned
 * verbatim; functions are invoked at exec time; Error instances are
 * thrown.
 */
export type ExecResponse = string | Buffer | (() => string | Buffer) | Error;

interface ExecEntry {
  prefix: string;
  response: ExecResponse;
}

/**
 * Dependency-injectable replacement for `node:child_process#execSync`.
 *
 * Each instance keeps its own registry — useful for keeping state
 * isolated between tests without resorting to a global mock.
 *
 * Matching rules:
 * - Each entry registers a command **prefix** (typically the full
 *   command line, but any prefix is accepted).
 * - Entries are tried in insertion order; first prefix that matches
 *   the command via `String#startsWith` wins.
 * - Unmatched commands throw `Error('unmocked exec command: <cmd>')`.
 */
export class MockExec {
  private entries: ExecEntry[] = [];

  /** Register a response for any command starting with `commandPrefix`. */
  register(commandPrefix: string, response: ExecResponse): this {
    this.entries.push({ prefix: commandPrefix, response });
    return this;
  }

  /** Resolve a command. Strict — unknown commands throw. */
  exec(command: string): string {
    for (const entry of this.entries) {
      if (command.startsWith(entry.prefix)) {
        const r = entry.response;
        if (r instanceof Error) throw r;
        if (typeof r === "function") {
          const out = r();
          return Buffer.isBuffer(out) ? out.toString("utf-8") : out;
        }
        return Buffer.isBuffer(r) ? r.toString("utf-8") : r;
      }
    }
    throw new Error(`unmocked exec command: ${command}`);
  }

  /** Snapshot of currently registered prefixes (for assertions). */
  prefixes(): readonly string[] {
    return this.entries.map((e) => e.prefix);
  }

  /** Drop all registered entries. */
  reset(): void {
    this.entries.length = 0;
  }
}

/** Create a fresh, isolated MockExec instance. */
export function createMockExec(): MockExec {
  return new MockExec();
}

// ---------------------------------------------------------------------
// Optional: route `node:child_process#execSync` calls through a MockExec
// ---------------------------------------------------------------------

let activeExec: MockExec | null = null;
let moduleMocked = false;

/**
 * Patch `node:child_process` so that any `execSync` call from production
 * code is routed through the supplied {@link MockExec} instance.
 *
 * Other exports from `node:child_process` continue to behave normally.
 *
 * NOTE: Bun's `mock.module()` is process-global. Once installed, the
 * mock persists for the rest of the test run; pass a different instance
 * via {@link setActiveExecMock} to swap behaviour between tests.
 */
export function installExecMock(instance: MockExec): void {
  activeExec = instance;
  if (moduleMocked) return;
  moduleMocked = true;
  // Resolve the real module lazily so we can re-export non-execSync APIs.
  const real = require("node:child_process") as typeof import("node:child_process");
  mock.module("node:child_process", () => ({
    ...real,
    execSync: (command: string, _options?: unknown) => {
      if (!activeExec) {
        throw new Error("installExecMock: no active MockExec instance");
      }
      return activeExec.exec(command);
    },
  }));
}

/**
 * Swap the active MockExec instance without reinstalling the module
 * mock. Pass `null` to make every subsequent `execSync` throw.
 */
export function setActiveExecMock(instance: MockExec | null): void {
  activeExec = instance;
}
