import type { TomoriState } from "@/types/db/schema";
import { getDiscordTextLength, truncateDiscordText } from "@/utils/text/discordTextLimits";

const LEGACY_PERSONA_DESCRIPTION_PREFIX = "{bot}'s Description: ";

// English seeds and /persona generate store "{bot}'s Personality:"; Japanese seeds store "{bot}の性格:".
const PERSONALITY_ATTRIBUTE_LABEL = /^\{bot\}(?:'s Personality|の性格)\s*[:：]\s*/;
const ATTRIBUTE_LABEL = /^\{bot\}(?:'s [^:：]{1,30}|の[^:：]{1,30})[:：]\s*/;
const SNIPPET_BREAKS = [" ", ",", "、", "，"];
const SNIPPET_ELLIPSIS = "...";

export function resolvePrefillPrompt(persona: TomoriState): string | null {
  if (persona.persona_prompt?.trim()) {
    return persona.persona_prompt.trim();
  }

  const legacyDescription = persona.attribute_list.find((attribute) =>
    attribute.startsWith(LEGACY_PERSONA_DESCRIPTION_PREFIX),
  );
  if (!legacyDescription) {
    return null;
  }

  const extractedDescription = legacyDescription.slice(LEGACY_PERSONA_DESCRIPTION_PREFIX.length).trim();
  return extractedDescription.length > 0 ? extractedDescription : null;
}

/**
 * Prefers the Personality attribute and falls back to the first attribute, so hand-written personas
 * without labelled attributes still get a select menu description.
 */
export function resolvePersonaSnippet(
  persona: Pick<TomoriState, "persona_nickname" | "attribute_list">,
  maxLength: number,
): string | null {
  const source =
    persona.attribute_list.find((attribute) => PERSONALITY_ATTRIBUTE_LABEL.test(attribute)) ??
    persona.attribute_list[0];
  if (!source) return null;

  const text = source
    .replace(ATTRIBUTE_LABEL, "")
    .replaceAll("{bot}", persona.persona_nickname)
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0) return null;
  if (getDiscordTextLength(text) <= maxLength) return text;

  const clipped = truncateDiscordText(text, maxLength - SNIPPET_ELLIPSIS.length, "");
  const cutsMidWord = !SNIPPET_BREAKS.includes(text.charAt(clipped.length));
  const lastBreak = Math.max(...SNIPPET_BREAKS.map((separator) => clipped.lastIndexOf(separator)));
  const trimmed = cutsMidWord && lastBreak > 0 ? clipped.slice(0, lastBreak) : clipped;
  return `${trimmed.replace(/[\s,、，]+$/u, "")}${SNIPPET_ELLIPSIS}`;
}
