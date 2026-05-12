/**
 * Text helpers and the static nudge message injected into `chat.message`
 * when a memory-trigger keyword is detected.
 *
 * `CODE_BLOCK_PATTERN` and `INLINE_CODE_PATTERN` are exported so other
 * modules (currently `./keywords.ts`) can strip code segments before
 * running their own regex checks — keyword detection must ignore content
 * the user clearly marked as code.
 *
 * `MEMORY_NUDGE_MESSAGE` is the literal text appended to `output.parts`;
 * its wording is part of the plugin's public contract and must not change
 * without a deliberate behavior update.
 */

export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
export const INLINE_CODE_PATTERN = /`[^`]+`/g;

export const MEMORY_NUDGE_MESSAGE = `[MEMORY TRIGGER DETECTED]
The user wants you to remember something. You MUST use the \`supermemory\` tool with \`mode: "add"\` to save this information.

Extract the key information the user wants remembered and save it as a concise, searchable memory.
- Use \`scope: "project"\` for project-specific preferences (e.g., "run lint with tests")
- Use \`scope: "user"\` for cross-project preferences (e.g., "prefers concise responses")
- Choose an appropriate \`type\`: "preference", "project-config", "learned-pattern", etc.

DO NOT skip this step. The user explicitly asked you to remember.`;

/**
 * Removes fenced (```...```) and inline (`...`) code from `text`. The two
 * patterns are stateful (`g` flag) but each call uses a freshly-scanned
 * input via `String.prototype.replace`, so there is no state leakage
 * between invocations.
 */
export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}
