/**
 * Readers for a persona option value that arrived from a client-rendered picker.
 *
 * A picker value is untrusted input: it can be stale, belong to another workspace, or be
 * malformed. These stay separate from the persona rows they resolve against so a caller that
 * only needs to validate a value does not import a command module.
 */

/**
 * Validates and parses an untrusted persona option value.
 * Strictly accepts only positive safe decimal integer IDs (rejects whitespace,
 * signs, decimals, junk, zero, and unsafe integers).
 */
export function parsePersonaOptionId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== value) {
    return null;
  }
  return id;
}

/**
 * Finds a persona in the server's persona list by an untrusted option value.
 * Returns null if the option value is missing/malformed or does not exist on the server.
 */
export function resolveSelectedPersona<T extends { persona_id?: number }>(
  personas: readonly T[],
  rawPersonaOption: unknown,
): T | null {
  const personaId = parsePersonaOptionId(rawPersonaOption);
  if (personaId === null) {
    return null;
  }
  return personas.find((p) => p.persona_id === personaId) ?? null;
}
