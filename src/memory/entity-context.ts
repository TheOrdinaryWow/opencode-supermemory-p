import { DEFAULT_ENTITY_CONTEXT as BASE_DEFAULT_ENTITY_CONTEXT } from "@/config/defaults";

export const MAX_ENTITY_CONTEXT_LENGTH = 1500;
export const DEFAULT_ENTITY_CONTEXT: string = BASE_DEFAULT_ENTITY_CONTEXT;

export function clampEntityContext(text: string): string {
  if (text.length <= MAX_ENTITY_CONTEXT_LENGTH) return text;

  const truncated = text.slice(0, MAX_ENTITY_CONTEXT_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");

  return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
}
