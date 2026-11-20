// Resolve in history order so later calls cannot change IDs in the cached prefix.
export function resolveToolCallId(
  id: string | undefined,
  interactionIndex: number,
  prefix: "call" | "toolu",
  usedIds: Set<string>,
): string {
  const canPreserveId = id && (prefix === "call" || !/[^a-zA-Z0-9_-]/.test(id)) && !usedIds.has(id);
  const fallbackId = `${prefix}_${interactionIndex}`;
  let resolvedId = canPreserveId ? id : fallbackId;
  let suffix = 1;
  while (usedIds.has(resolvedId)) {
    resolvedId = `${fallbackId}_${suffix++}`;
  }
  usedIds.add(resolvedId);
  return resolvedId;
}
