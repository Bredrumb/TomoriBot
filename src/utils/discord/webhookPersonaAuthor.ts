import type { TomoriState } from "@/types/db/schema";
import { normalizeRenderModifierName, resolveRenderModifierSourcePersona } from "@/utils/discord/renderModifierParser";
import { resolveSpriteMessageDisplayName } from "@/utils/discord/spriteMessageLabel";

export interface ResolvedWebhookPersonaAuthor {
  persona: TomoriState;
  displayName: string;
}

// Clean names and "Persona (neutral)" check persisted sprite mappings because Discord stores the persona name while
// context needs the rendered label or revert.
export async function resolveWebhookPersonaAuthor(
  messageId: string,
  webhookName: string,
  personaByNickname: Map<string, TomoriState>,
): Promise<ResolvedWebhookPersonaAuthor | null> {
  const renderModifierSource = resolveRenderModifierSourcePersona(webhookName, personaByNickname);
  const persona = renderModifierSource?.persona ?? personaByNickname.get(normalizeRenderModifierName(webhookName));
  if (!persona) return null;

  const spriteDisplayName =
    renderModifierSource && !renderModifierSource.isNeutralAppearance
      ? null
      : await resolveSpriteMessageDisplayName(messageId, persona.persona_id, persona.persona_nickname);

  return {
    persona,
    displayName: spriteDisplayName ?? renderModifierSource?.displayName ?? persona.persona_nickname,
  };
}
