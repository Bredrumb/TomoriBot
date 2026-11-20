export function formatMemoryWithId(memoryId: number, content: string, tags?: string[]): string {
  const tagPrefix = tags && tags.length > 0 ? `[tags: ${tags.join(", ")}] ` : "";
  return `ID:${memoryId} ${tagPrefix}${content}`;
}
