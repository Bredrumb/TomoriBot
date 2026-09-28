const MARKDOWN_TABLE_CACHE_TTL_MS = 120 * 60 * 1_000;

interface StoredMarkdownTableEntry {
  markdown: string;
  cachedAt: number;
}

const cache = new Map<string, StoredMarkdownTableEntry>();

export function getCachedRenderedMarkdownTable(messageId: string): string | null {
  const entry = cache.get(messageId);
  if (!entry) return null;

  if (Date.now() - entry.cachedAt > MARKDOWN_TABLE_CACHE_TTL_MS) {
    cache.delete(messageId);
    return null;
  }

  return entry.markdown;
}

export function setCachedRenderedMarkdownTable(messageId: string, markdown: string): void {
  cache.set(messageId, {
    markdown,
    cachedAt: Date.now(),
  });
}

export function clearMarkdownTableCache(): void {
  cache.clear();
}

export function getMarkdownTableCacheSize(): number {
  return cache.size;
}
