import type { TomoriState } from "@/types/db/schema";

export function groupPersonasByLineage(personas: readonly TomoriState[]): Map<number, TomoriState[]> {
  const grouped = new Map<number, TomoriState[]>();
  for (const persona of personas) {
    const lineageId = persona.persona_lineage_id;
    if (lineageId === undefined || lineageId === null || lineageId === 0) continue;
    const bucket = grouped.get(lineageId);
    if (bucket) bucket.push(persona);
    else grouped.set(lineageId, [persona]);
  }
  return grouped;
}

// Non-alter members take precedence because the lineage is named after them, and sharing this helper prevents label
// and thumbnail mismatches.
export function personaRepresentativeForLineage(
  personas: readonly TomoriState[],
  lineageId: number,
): TomoriState | null {
  const sharing = personas.filter((persona) => persona.persona_lineage_id === lineageId);
  return sharing.find((persona) => !persona.is_alter) ?? sharing[0] ?? null;
}
