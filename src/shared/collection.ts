export function dedupe<T>(items: T[], getKey: (item: T) => string = (item) => String(item)): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const normalizedKey = getKey(item).toLowerCase().trim();

    if (normalizedKey === "") {
      continue;
    }

    if (seen.has(normalizedKey)) {
      continue;
    }

    seen.add(normalizedKey);
    result.push(item);
  }

  return result;
}
