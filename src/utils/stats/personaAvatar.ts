import type { TomoriPresetRow, TomoriState } from "@/types/db/schema";
import { configRepository } from "@/utils/db/repositories";
import { loadStoredPersonaAvatarDataUri } from "@/utils/storage/avatarStorage";

export interface StatsPresetAvatarLookup {
  byPointerKey: Map<string, string>;
  byLineage: Map<number, string>;
}

function pointerKey(lineageId: number, language: string): string {
  return `${lineageId}:${language}`;
}

function normalizeLineageId(value: unknown): number | null {
  let normalized: number;
  if (typeof value === "number") {
    normalized = value;
  } else if (typeof value === "bigint") {
    normalized = Number(value);
  } else if (typeof value === "string" && value.trim() !== "") {
    normalized = Number(value);
  } else {
    return null;
  }

  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

export function buildStatsPresetAvatarLookup(presets: TomoriPresetRow[] | null | undefined): StatsPresetAvatarLookup {
  const lookup: StatsPresetAvatarLookup = {
    byPointerKey: new Map<string, string>(),
    byLineage: new Map<number, string>(),
  };

  for (const preset of presets ?? []) {
    const lineageId = normalizeLineageId(preset.preset_lineage_id ?? null);
    const language = preset.preset_language?.trim();
    const avatarUrl = preset.preset_avatar_shared_url?.trim();
    if (lineageId === null || !language || !avatarUrl) {
      continue;
    }

    lookup.byPointerKey.set(pointerKey(lineageId, language), avatarUrl);
    if (!lookup.byLineage.has(lineageId)) {
      lookup.byLineage.set(lineageId, avatarUrl);
    }
  }

  return lookup;
}

export async function loadStatsPresetAvatarLookup(): Promise<StatsPresetAvatarLookup> {
  return buildStatsPresetAvatarLookup(await configRepository.loadAllPresets());
}

export function resolveStatsPersonaAvatarReference(
  persona: Pick<
    TomoriState,
    "webhook_avatar_url" | "is_pointer" | "preset_lineage_id" | "preset_language" | "persona_lineage_id"
  >,
  presetAvatars: StatsPresetAvatarLookup,
): string | null {
  const directReference = persona.webhook_avatar_url?.trim();
  if (directReference) {
    return directReference;
  }

  if (!persona.is_pointer) {
    return null;
  }

  const lineageId = normalizeLineageId(persona.preset_lineage_id ?? persona.persona_lineage_id ?? null);
  if (lineageId === null) {
    return null;
  }

  const language = persona.preset_language?.trim();
  if (language) {
    const exactReference = presetAvatars.byPointerKey.get(pointerKey(lineageId, language));
    if (exactReference) {
      return exactReference;
    }
  }

  return presetAvatars.byLineage.get(lineageId) ?? null;
}

export async function loadStatsPersonaAvatarDataUri(
  persona: Pick<
    TomoriState,
    "webhook_avatar_url" | "is_pointer" | "preset_lineage_id" | "preset_language" | "persona_lineage_id"
  >,
  presetAvatars: StatsPresetAvatarLookup,
): Promise<string | null> {
  const reference = resolveStatsPersonaAvatarReference(persona, presetAvatars);
  return reference ? await loadStoredPersonaAvatarDataUri(reference) : null;
}
