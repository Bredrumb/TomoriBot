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

  for (const sourceName of collectRenderModifierSourceNames("", sourceNames)) {
    const pattern = new RegExp(
      `^\\s*(${escapeRegExp(sourceName)})\\s*\\(([^()\\n\\r:：]{1,${RENDER_MODIFIER_LIMIT}})\\)\\s*[:：][ \\t]*`,
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

export function isAllowedRenderModifierSpeakerLabel(label: string, sourceNames: readonly string[]): boolean {
  const parsed = parseRenderModifierWebhookName(label);
  if (!parsed) return false;
  const normalizedSource = normalizeRenderModifierName(parsed.sourceName);
  return collectRenderModifierSourceNames("", sourceNames).some(
    (sourceName) => normalizeRenderModifierName(sourceName) === normalizedSource,
  );
}

export function resolveRenderModifierSourcePersona(
  webhookName: string,
  personaByNickname: Map<string, TomoriState>,
): { persona: TomoriState; displayName: string } | null {
  const parsed = parseRenderModifierWebhookName(webhookName);
  if (!parsed) return null;

  const persona = personaByNickname.get(normalizeRenderModifierName(parsed.sourceName));
  if (!persona) return null;

  return {
    persona,
    displayName: formatRenderModifierWebhookName(persona.persona_nickname, parsed.modifier),
  };
}
