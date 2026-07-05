import type { TomoriState } from "@/types/db/schema";
import { normalizeUserTargetInput } from "@/utils/discord/targetResolver";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";

const WEBHOOK_USERNAME_LIMIT = 80;
const RENDER_MODIFIER_LIMIT = 64;
const TRUNCATION_SUFFIX = "...";

export type RenderModifierName = {
  sourceName: string;
  modifier: string;
};

export type LeadingRenderModifierMatch = RenderModifierName & {
  body: string;
  matchedPrefix: string;
};

export function normalizeRenderModifierName(value: string): string {
  return normalizeUserTargetInput(value);
}

export function parseRenderModifierWebhookName(value?: string | null): RenderModifierName | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const match = /^(.+?)\s+\(([^()\n\r]{1,64})\)$/u.exec(trimmed);
  const sourceName = match?.[1]?.trim();
  const modifier = match?.[2]?.trim();
  if (!sourceName || !modifier) return null;

  return { sourceName, modifier };
}

export function formatRenderModifierWebhookName(sourceName: string, modifier: string): string {
  const cleanSourceName = sourceName.trim();
  const cleanModifier = modifier.trim();
  if (!cleanSourceName || !cleanModifier) return cleanSourceName || cleanModifier || "Persona";

  const suffix = ` (${cleanModifier})`;
  const availableSourceLength = WEBHOOK_USERNAME_LIMIT - suffix.length;
  if (availableSourceLength >= cleanSourceName.length) {
    return `${cleanSourceName}${suffix}`;
  }

  if (availableSourceLength >= TRUNCATION_SUFFIX.length + 1) {
    return `${cleanSourceName.slice(0, availableSourceLength - TRUNCATION_SUFFIX.length).trimEnd()}${TRUNCATION_SUFFIX}${suffix}`;
  }

  const availableModifierLength = WEBHOOK_USERNAME_LIMIT - cleanSourceName.length - 3;
  if (availableModifierLength >= TRUNCATION_SUFFIX.length + 1) {
    const truncatedModifier = `${cleanModifier.slice(0, availableModifierLength - TRUNCATION_SUFFIX.length).trimEnd()}${TRUNCATION_SUFFIX}`;
    return `${cleanSourceName} (${truncatedModifier})`;
  }

  return `${cleanSourceName.slice(0, WEBHOOK_USERNAME_LIMIT - TRUNCATION_SUFFIX.length).trimEnd()}${TRUNCATION_SUFFIX}`;
}

export function collectRenderModifierSourceNames(activeName: string, aliases: readonly string[] = []): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [activeName, ...aliases]) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    const normalized = normalizeRenderModifierName(trimmed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    names.push(trimmed);
  }

  return names.sort((left, right) => right.length - left.length);
}

export function parseLeadingRenderModifier(
  text: string,
  sourceNames: readonly string[],
): LeadingRenderModifierMatch | null {
  if (!text.trim() || text.trimStart().startsWith("```")) return null;

  const collectedSourceNames = collectRenderModifierSourceNames("", sourceNames);
  const labelChainAlternation = buildSourceLabelAlternation(collectedSourceNames);
  const labelChainPrefix = labelChainAlternation ? `(?:(?:${labelChainAlternation})\\s*[:：][ \\t]*)*` : "";

  for (const sourceName of collectedSourceNames) {
    const pattern = new RegExp(
      `^\\s*${labelChainPrefix}(${escapeRegExp(sourceName)})\\s*\\(([^()\\n\\r:：]{1,${RENDER_MODIFIER_LIMIT}})\\)\\s*[:：][ \\t]*`,
      "iu",
    );
    const match = pattern.exec(text);
    const matchedSourceName = match?.[1]?.trim();
    const modifier = match?.[2]?.trim();
    if (!match || !matchedSourceName || !modifier) continue;

    return {
      sourceName: matchedSourceName,
      modifier,
      body: text.slice(match[0].length),
      matchedPrefix: match[0],
    };
  }

  return null;
}

function buildSourceLabelAlternation(sourceNames: readonly string[]): string | null {
  const escapedNames = sourceNames.map((sourceName) => escapeRegExp(sourceName.trim())).filter(Boolean);
  return escapedNames.length > 0 ? `(?:${escapedNames.join("|")})` : null;
}

export function isAllowedRenderModifierSpeakerLabel(label: string, sourceNames: readonly string[]): boolean {
  const parsed = parseRenderModifierWebhookName(label);
  if (!parsed) return false;
  const normalizedSource = normalizeRenderModifierName(parsed.sourceName);
  return collectRenderModifierSourceNames("", sourceNames).some(
    (sourceName) => normalizeRenderModifierName(sourceName) === normalizedSource,
  );
}

/**
 * Resolves the source persona behind a decorated webhook name, accepting both
 * name orientations, and rebuilds the model-facing "SourcePersona (modifier)"
 * label:
 *
 * 1. Flipped copied-identity format (current): "impersonated (SourcePersona)" —
 *    Discord shows the impersonated name first so the disguise reads naturally,
 *    while the model-facing label keeps the source persona first.
 * 2. Legacy format: "SourcePersona (modifier)" — pre-flip copied identities and
 *    pre-clean-name sprite messages still in fetched history windows.
 *
 * When BOTH parts match personas (persona impersonating another persona) the
 * flipped interpretation wins, since all newly sent messages use it; legacy
 * persona-on-persona messages in the transition window are misattributed until
 * they age out of the history fetch window.
 */
export function resolveRenderModifierSourcePersona(
  webhookName: string,
  personaByNickname: Map<string, TomoriState>,
): { persona: TomoriState; displayName: string } | null {
  const parsed = parseRenderModifierWebhookName(webhookName);
  if (!parsed) return null;

  const flippedPersona = personaByNickname.get(normalizeRenderModifierName(parsed.modifier));
  if (flippedPersona) {
    return {
      persona: flippedPersona,
      displayName: formatRenderModifierWebhookName(flippedPersona.persona_nickname, parsed.sourceName),
    };
  }

  const legacyPersona = personaByNickname.get(normalizeRenderModifierName(parsed.sourceName));
  if (!legacyPersona) return null;

  return {
    persona: legacyPersona,
    displayName: formatRenderModifierWebhookName(legacyPersona.persona_nickname, parsed.modifier),
  };
}
