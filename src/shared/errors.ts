/**
 * AppError — the closed discriminated union of every error type the plugin
 * surfaces to callers. Each variant carries a `kind` tag (for narrowing) plus
 * a human-readable `message`. An optional `cause` preserves the underlying
 * exception or low-level error for diagnostics without coupling consumers to
 * a specific runtime error class.
 */
export type AppError = NetworkError | AuthError | ConfigError | StorageError | ValidationError | UnknownError;

export type NetworkError = { kind: "NetworkError"; message: string; cause?: unknown };
export type AuthError = { kind: "AuthError"; message: string; cause?: unknown };
export type ConfigError = { kind: "ConfigError"; message: string; cause?: unknown };
export type StorageError = { kind: "StorageError"; message: string; cause?: unknown };
export type ValidationError = { kind: "ValidationError"; message: string; cause?: unknown };
export type UnknownError = { kind: "UnknownError"; message: string; cause?: unknown };
