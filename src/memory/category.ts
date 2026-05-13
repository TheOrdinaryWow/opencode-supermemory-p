export type Category = "preference" | "fact" | "decision" | "entity" | "other";

const CODE_BLOCK_RE = /```[\s\S]*?```/g;

// Order below mirrors the priority ranking in detectCategory.
const PREFERENCE_RE = /\b(i (prefer|like|always|never|use|hate)|prefer to|like to|always|never)\b/i;
const DECISION_RE = /\b(decided|decision|chose|picked|going to use|will use|switched to)\b/i;
const ENTITY_RE = /\b(my (name|team|company|project|email|phone)|i work at|i am at)\b/i;
const FACT_RE = /\b(is|are|was|were|has|have|works|works at)\b/i;

export function detectCategory(content: string | null | undefined): Category {
  if (typeof content !== "string" || content.length === 0) return "other";

  const stripped = content.replace(CODE_BLOCK_RE, "");
  if (stripped.trim().length === 0) return "other";

  if (PREFERENCE_RE.test(stripped)) return "preference";
  if (DECISION_RE.test(stripped)) return "decision";
  if (ENTITY_RE.test(stripped)) return "entity";
  if (FACT_RE.test(stripped)) return "fact";

  return "other";
}
