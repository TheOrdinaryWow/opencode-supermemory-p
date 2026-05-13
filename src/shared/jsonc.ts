import { type ParseError, parse, printParseErrorCode, stripComments } from "jsonc-parser/lib/esm/main.js";

export function stripJsoncComments(content: string): string {
  return stripComments(content).replace(/,\s*([}\]])/g, "$1");
}

export function parseJsonc<T = unknown>(content: string): T {
  const errors: ParseError[] = [];
  const value = parse(content, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: `errors[0]` is guaranteed to exist since we check `errors.length > 0`
    const first = errors[0]!;
    throw new SyntaxError(`${printParseErrorCode(first.error)} at offset ${first.offset}`);
  }
  return value as T;
}
