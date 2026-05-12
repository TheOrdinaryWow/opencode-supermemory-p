import type { AppError } from "./errors.js";

/**
 * Result<T, E> — explicit success/failure discriminated union. Use over
 * thrown exceptions for *expected* failures (validation, missing config,
 * external service errors). Defaults to AppError so most call sites can
 * write `Result<User>` and stay aligned with the canonical error union.
 */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;
