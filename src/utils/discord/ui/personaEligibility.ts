import type { TomoriState } from "@/types/db/schema";

export function hasPersonaPrompt(persona: TomoriState): boolean {
  return typeof persona.persona_prompt === "string" && persona.persona_prompt.trim().length > 0;
}
