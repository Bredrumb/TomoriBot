/**
 * Helper utilities for formatting long-term memory IDs.
 * IDs are shown to the LLM and used by the update_long_term_memory tool.
 */

/**
 * Format a memory entry with its ID for LLM context display.
 */
export function formatMemoryWithId(memoryId: number, content: string): string {
	return `ID:${memoryId} ${content}`;
}
