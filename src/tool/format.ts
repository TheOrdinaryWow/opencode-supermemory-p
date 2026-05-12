// Shapes a single-scope searchMemories result into the JSON envelope returned
// to the agent. Kept tiny and dependency-free so it can be unit-tested in
// isolation if needed.
export function formatSearchResults(
  query: string,
  scope: string | undefined,
  results: { results?: Array<{ id: string; memory?: string; chunk?: string; similarity?: number }> },
  limit?: number,
): string {
  const memoryResults = results.results || [];
  return JSON.stringify({
    success: true,
    query,
    scope,
    count: memoryResults.length,
    results: memoryResults.slice(0, limit || 10).map((r) => ({
      id: r.id,
      content: r.memory || r.chunk,
      similarity: Math.round((r.similarity ?? 0) * 100),
    })),
  });
}
