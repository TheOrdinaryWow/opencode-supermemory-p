export interface MemoryCounts {
  profile: number;
  projectMemories: number;
  relevantMemories: number;
}

export function formatMemoFooter(counts: MemoryCounts): string {
  const total = counts.profile + counts.projectMemories + counts.relevantMemories;
  if (total === 0) return "";

  return `[Supermemory: ${total} memories loaded]`;
}
