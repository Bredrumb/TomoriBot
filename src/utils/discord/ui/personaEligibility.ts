import type { TomoriState } from "@/types/db/schema";

/**
 * True when the persona has a non-blank persona prompt.
 *
 * The `prompt-remove` route guard and the `removePrompt` operation share this predicate, so a
 * whitespace-only prompt is refused as absent at both layers.
 */
export function hasPersonaPrompt(persona: TomoriState): boolean {
  return typeof persona.persona_prompt === "string" && persona.persona_prompt.trim().length > 0;
}
