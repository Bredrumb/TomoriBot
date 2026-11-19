import type { StructuredContextItem } from "@/types/misc/context";
import { log } from "@/utils/misc/logger";

// Side channel for heavy enhanced-context payloads because ToolRegistry.executionHistory pins the last 1000
// ToolResult.data entries in memory.

const STASH_TTL_MS = 300_000;
const STASH_MAX_ENTRIES = 16;

interface StashedEntry {
  item: StructuredContextItem;
  storedAt: number;
}

const stash = new Map<string, StashedEntry>();

export function stashEnhancedContextItem(item: StructuredContextItem): string {
  const now = Date.now();
  evictStaleEntries(now);

  // An entry is normally consumed milliseconds later by the same turn's restart, so anything
  // still here is from a turn that aborted before the loop could drain it.
  while (stash.size >= STASH_MAX_ENTRIES) {
    const oldestKey: string | undefined = stash.keys().next().value;
    if (oldestKey === undefined) break;
    stash.delete(oldestKey);
    log.warn(
      `Enhanced-context stash reached ${STASH_MAX_ENTRIES} entries; dropped the oldest undrained payload to bound memory.`,
    );
  }

  const key = crypto.randomUUID();
  stash.set(key, { item, storedAt: now });
  return key;
}

export function takeEnhancedContextItem(key: string): StructuredContextItem | undefined {
  const entry = stash.get(key);
  if (!entry) return undefined;
  stash.delete(key);
  return entry.item;
}

function evictStaleEntries(now: number): void {
  for (const [key, entry] of stash) {
    if (now - entry.storedAt > STASH_TTL_MS) {
      stash.delete(key);
    }
  }
}
