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

// Nickname fallback is required because Discord submits raw typed text when the user does not pick an autocomplete
// suggestion.
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
