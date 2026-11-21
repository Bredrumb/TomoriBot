import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { ToolContext } from "@/types/tool/interfaces";
import { getCachedPersonaSprites } from "@/utils/cache/personaSpriteCache";
import type { PersonaPostAppearance } from "@/utils/discord/webhook/personaPost";
import { validatePersonaSpriteName, PERSONA_SPRITE_LIMITS } from "@/utils/persona/sprites";
import { localizer } from "@/utils/text/localizer";

export function getToolSpriteRoster(
  contextItems: readonly StructuredContextItem[] | undefined,
  personaId: number | undefined,
) {
  return contextItems?.find(
    (item) =>
      item.metadataTag === ContextItemTag.KNOWLEDGE_PERSONA_SPRITES && item.personaSprites?.personaId === personaId,
  )?.personaSprites;
}

export async function resolveToolSpriteSelection(
  args: Record<string, unknown>,
  context: ToolContext,
  personaId: number | undefined,
): Promise<{ success: true; appearance?: PersonaPostAppearance } | { success: false; error: string }> {
  if (args.sprite === undefined) return { success: true };
  const roster = getToolSpriteRoster(context.contextItems, personaId);
  if (
    context.isUserImpersonation ||
    context.deliveryMode === "user_impersonation" ||
    context.streamContext?.deliveryMode === "user_impersonation" ||
    !roster?.spriteKeys.length
  )
    return { success: false, error: localizer(context.locale, "tools.sprite_selection.unavailable") };
  if (typeof args.sprite !== "string")
    return { success: false, error: localizer(context.locale, "tools.sprite_selection.invalid") };
  if (!args.sprite.trim()) return { success: true, appearance: { kind: "base" } };
  const validation = validatePersonaSpriteName(args.sprite);
  if (!validation.ok) return { success: false, error: localizer(context.locale, "tools.sprite_selection.invalid") };
  const key = validation.spriteKey;
  const sprites = await getCachedPersonaSprites(roster.personaId);
  const sprite = sprites
    .slice(0, PERSONA_SPRITE_LIMITS.PROMPT_MAX_COUNT)
    .find((entry) => entry.sprite_key === key && roster.spriteKeys.includes(key));
  if (!sprite) return { success: false, error: localizer(context.locale, "tools.sprite_selection.invalid") };
  return { success: true, appearance: { kind: "sprite", sprite } };
}
