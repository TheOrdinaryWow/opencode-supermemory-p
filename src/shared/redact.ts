/**
 * Best-effort PII / secret redaction for log previews.
 *
 * Used by the memory client when echoing captured content into the plugin
 * log so users can audit "what did the plugin actually save?" without
 * exposing emails, tokens, or full URLs in the rotating log file.
 *
 * Patterns intentionally err on the side of redaction — false positives
 * (over-redaction) are acceptable; false negatives (leaking a secret into
 * the log) are not. Order matters: token-shaped strings are matched before
 * the catch-all URL pattern so e.g. `https://x.com/sm_abc...` keeps both
 * the URL and the token redacted.
 */

interface Pattern {
  re: RegExp;
  replace: string;
}

const PATTERNS: ReadonlyArray<Pattern> = [
  // High-entropy secret prefixes from common services.
  { re: /\bsm_[A-Za-z0-9_-]{16,}/g, replace: "[SM_KEY]" },
  { re: /\bsk-[A-Za-z0-9_-]{16,}/g, replace: "[OPENAI_KEY]" },
  { re: /\bgh[pousr]_[A-Za-z0-9_]{16,}/g, replace: "[GH_TOKEN]" },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replace: "[SLACK_TOKEN]" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: "[AWS_KEY]" },
  // Bearer auth headers.
  { re: /(authorization:\s*)bearer\s+[A-Za-z0-9._\-+/=]+/gi, replace: "$1Bearer [REDACTED]" },
  // Email addresses (plain).
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: "[EMAIL]" },
  // URLs — match http/https schemes only, leave file: / relative paths alone.
  // The character class excludes `[` and `]` so earlier replacements that
  // left `[SM_KEY]`-style placeholders embedded in a URL are preserved.
  { re: /\bhttps?:\/\/[^\s<>"')[\]]+/g, replace: "[URL]" },
];

const PREVIEW_MAX = 200;

/**
 * Strip secrets/PII and clamp to at most `PREVIEW_MAX` chars.
 * Returns a single line with newlines collapsed to spaces so the result
 * fits in one log entry.
 */
export function redactedPreview(content: string): string {
  let out = content;
  for (const { re, replace } of PATTERNS) {
    out = out.replace(re, replace);
  }
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > PREVIEW_MAX) {
    out = `${out.slice(0, PREVIEW_MAX)}\u2026`;
  }
  return out;
}
