const DEFAULT_TTL_MINUTES = 120;

interface StoredMarkdownTableEntry {
  markdown: string;
  cachedAt: number;
}

const cache = new Map<string, StoredMarkdownTableEntry>();

function getTtlMs(): number {
  const parsed = Number.parseInt(process.env.MARKDOWN_TABLE_CACHE_TTL_MINUTES ?? "", 10);
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MINUTES;
  return minutes * 60 * 1_000;
}

export function getCachedRenderedMarkdownTable(messageId: string): string | null {
  const entry = cache.get(messageId);
  if (!entry) return null;

  if (Date.now() - entry.cachedAt > getTtlMs()) {
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
