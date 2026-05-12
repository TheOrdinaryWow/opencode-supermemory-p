import { describe, expect, it } from "bun:test";

import type { AppError } from "../../src/shared/errors.ts";
import { err, isErr, isOk, ok, type Result } from "../../src/shared/result.ts";

describe("Result — constructors", () => {
  it("ok() wraps a value in the success branch", () => {
    const r = ok(42);
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it("err() wraps an AppError in the failure branch", () => {
    const e: AppError = { kind: "NetworkError", message: "boom" };
    const r = err(e);
    expect(r).toEqual({ ok: false, error: e });
  });

  it("err() accepts any custom error type (not just AppError)", () => {
    // Result is parameterized on E; constructors must not pin to AppError.
    const r = err("plain-string-error" as const);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("plain-string-error");
    }
  });
});

describe("Result — type guards", () => {
  it("isOk() narrows to the success branch and exposes `value`", () => {
    const r: Result<number> = ok(7);
    if (!isOk(r)) throw new Error("expected ok branch");
    // Inside this block, the compiler knows `r.value` is number.
    expect(r.value).toBe(7);
  });

  it("isErr() narrows to the failure branch and exposes `error`", () => {
    const r: Result<number> = err({ kind: "ValidationError", message: "bad input" });
    if (!isErr(r)) throw new Error("expected err branch");
    expect(r.error.kind).toBe("ValidationError");
    expect(r.error.message).toBe("bad input");
  });

  it("isOk() and isErr() are exact inverses for any Result", () => {
    const success: Result<string> = ok("hi");
    const failure: Result<string> = err({ kind: "UnknownError", message: "x" });

    expect(isOk(success)).toBe(true);
    expect(isErr(success)).toBe(false);
    expect(isOk(failure)).toBe(false);
    expect(isErr(failure)).toBe(true);
  });
});

describe("Result — value semantics", () => {
  it("preserves nested object references (no defensive copy)", () => {
    const inner = { nested: [1, 2, 3] };
    const r = ok(inner);
    if (!isOk(r)) throw new Error("expected ok branch");
    expect(r.value).toBe(inner);
  });

  it("preserves the cause field on AppError variants", () => {
    const cause = new Error("low-level");
    const r = err<AppError>({ kind: "StorageError", message: "write failed", cause });
    if (!isErr(r)) throw new Error("expected err branch");
    expect(r.error.cause).toBe(cause);
  });
});
