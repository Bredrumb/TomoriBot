/**
 * Helper utilities for formatting long-term memory IDs.
 * IDs are shown to the LLM and used by the update_long_term_memory tool.
 */

/**
 * Format a memory entry with its ID for LLM context display.
 */
export function formatMemoryWithId(memoryId: number, content: string, tags?: string[]): string {
  const tagPrefix = tags && tags.length > 0 ? `[tags: ${tags.join(", ")}] ` : "";
  return `ID:${memoryId} ${tagPrefix}${content}`;
}
