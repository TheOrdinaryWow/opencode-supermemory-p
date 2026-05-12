// Re-export shim: the canonical implementation now lives in src/shared/jsonc.ts.
// Existing consumers (src/config.ts, tests/unit/jsonc.test.ts) continue to
// import from this path while subsequent refactor tasks migrate them.
export * from "../shared/jsonc.js";
