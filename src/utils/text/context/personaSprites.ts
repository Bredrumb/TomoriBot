import type { PersonaSpriteRow, TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { getCachedPersonaSprites } from "@/utils/cache/personaSpriteCache";
import { PERSONA_SPRITE_LIMITS } from "@/utils/persona/sprites";

const DEFAULT_USAGE_INSTRUCTIONS = "Use when this sprite fits the current emotion or situation.";

export function buildPersonaSpritePromptText(
  botName: string,
  sprites: readonly PersonaSpriteRow[],
  maxCount = PERSONA_SPRITE_LIMITS.PROMPT_MAX_COUNT,
): string | null {
  const usableSprites = sprites.slice(0, maxCount);
  if (usableSprites.length === 0) {
    return null;
  }

  const lines = [
    `Available sprites for ${botName}:`,
    "",
    `To use a sprite, ${botName} must start a response line with this exact format:`,
    `\`${botName} ({sprite name}):\``,
    "",
    "Only use the sprite names listed below. Do not invent new sprite names.",
    `If no listed sprite fits, respond normally as \`${botName}:\`.`,
    "",
    "Valid sprite labels:",
  ];

  for (const sprite of usableSprites) {
    const instructions = sprite.usage_instructions.trim() || DEFAULT_USAGE_INSTRUCTIONS;
    lines.push(`\`${botName} (${sprite.sprite_name}):\` ${instructions}`);
  }

  return lines.join("\n");
}

export async function buildPersonaSpriteContextItem(params: {
  tomoriState?: TomoriState | null;
  botName: string;
  isUserImpersonation: boolean;
}): Promise<StructuredContextItem | null> {
  const personaId = params.tomoriState?.persona_id;
  if (params.isUserImpersonation || typeof personaId !== "number") {
    return null;
  }

  const sprites = await getCachedPersonaSprites(personaId);
  const promptText = buildPersonaSpritePromptText(params.botName, sprites);
  if (!promptText) {
    return null;
  }

  return {
    role: "system",
    parts: [{ type: "text", text: promptText }],
    metadataTag: ContextItemTag.KNOWLEDGE_PERSONA_SPRITES,
  };
}
