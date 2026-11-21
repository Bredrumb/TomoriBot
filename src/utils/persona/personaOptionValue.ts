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
 * Finds a persona by a picked suggestion's ID, or by typed text equal to exactly one nickname ignoring
 * case, since Discord submits the text when nothing is picked; a partial or shared name resolves to null.
 */
export function resolveSelectedPersona<T extends { persona_id?: number; persona_nickname?: string | null }>(
  personas: readonly T[],
  rawPersonaOption: unknown,
): T | null {
  const personaId = parsePersonaOptionId(rawPersonaOption);
  const picked = personaId === null ? undefined : personas.find((p) => p.persona_id === personaId);
  if (picked) return picked;
  if (typeof rawPersonaOption !== "string") return null;

  const typed = rawPersonaOption.trim().toLowerCase();
  if (!typed) return null;
  const named = personas.filter((p) => p.persona_nickname?.trim().toLowerCase() === typed);
  return named.length === 1 ? (named[0] ?? null) : null;
}
