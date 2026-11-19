import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { lorebookEntryInputSchema, LOREBOOK_ENTRIES_PER_SCOPE_MAX } from "@/modules/lorebooks/db/types";

import type { Client, Guild } from "discord.js";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository } from "@/utils/db/repositories";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { log } from "@/utils/misc/logger";
import { resolvePersonaAvatarPublicUrl, uploadPersonaAvatarToStorage } from "@/utils/storage/avatarStorage";
import { getAllBaseTriggerWords } from "@/utils/text/localizer";
import { selectUnclaimedTriggerWords } from "@/utils/text/triggerWords";
import type { PresetImportMode, PresetExportData } from "@/types/preset/presetExport";
import { EMPTY_PERSONA_NAMING_CONFIG } from "@/types/personaNaming";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import {
  DEFAULT_NATURAL_NUDGE_TALKATIVENESS,
  personaAuthoredIdleNudgesSchema,
  type PersonaAuthoredIdleNudge,
} from "@/modules/natural-nudges/db/types";

export interface ImportAlterPresetParams {
  client: Client;
  guild: Guild | null;
  serverDiscId: string;
  presetData: PresetExportData;
  identityMode: "preserve" | "fork";
  avatarImageBuffer: Buffer | null;
  importMode?: PresetImportMode;
}

export type ImportAlterPresetResult =
  | {
      ok: true;
      personaId: number;
      nickname: string;
      displayedTriggers: string[];
      uniqueTriggerCount: number;
      usedMainAvatarFallback: boolean;
      hasNoTriggers: boolean;
      mainPersonaNickname: string;
      fallbackAvatarDisplayUrl: string | null;
    }
  | { ok: false; reason: "limit_reached"; current: number; max: number }
  | { ok: false; reason: "name_conflict"; name: string }
  | { ok: false; reason: "no_main_persona" }
  | { ok: false; reason: "config_failed" }
  | { ok: false; reason: "insert_failed" };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505"
  );
}

export async function importAlterPreset(params: ImportAlterPresetParams): Promise<ImportAlterPresetResult> {
  const { client, guild, serverDiscId, presetData, identityMode, avatarImageBuffer, importMode = "card" } = params;

  if (
    presetData.lorebook_entries !== undefined &&
    !lorebookEntryInputSchema.array().max(LOREBOOK_ENTRIES_PER_SCOPE_MAX).safeParse(presetData.lorebook_entries).success
  ) {
    return { ok: false, reason: "config_failed" };
  }

  let importedIdleNudges: PersonaAuthoredIdleNudge[] | undefined;
  if (presetData.natural_nudge_idle_nudges !== undefined) {
    const parsedIdleNudges = personaAuthoredIdleNudgesSchema.safeParse(presetData.natural_nudge_idle_nudges);
    if (!parsedIdleNudges.success) {
      return { ok: false, reason: "config_failed" };
    }
    importedIdleNudges = parsedIdleNudges.data;
  }

  const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
  const personaLimits = getMemoryLimits();

  if (allPersonas.length >= personaLimits.maxPersonasPerServer) {
    return {
      ok: false,
      reason: "limit_reached",
      current: allPersonas.length,
      max: personaLimits.maxPersonasPerServer,
    };
  }

  const existingNames = allPersonas.map((persona) => normalizePersonaName(persona.persona_nickname));
  const importName = normalizePersonaName(presetData.tomori_nickname);
  if (existingNames.includes(importName)) {
    return { ok: false, reason: "name_conflict", name: presetData.tomori_nickname };
  }

  // Gather every trigger already claimed by existing personas so the new
  //    alter never steals an overlapping trigger word. Reserve the base words
  //    ("tomori" etc.) too: they belong to the main persona regardless of locale,
  //    and the loader's single-owner dedup would strip them from an alter anyway.
  const claimedTriggerWords = [
    ...getAllBaseTriggerWords(),
    ...allPersonas.flatMap((persona) => persona.trigger_words ?? []),
  ];

  // Filter the incoming triggers to the unique set this alter actually owns.
  //    This is what we store and display for both custom and official-preset
  //    (pointer) imports; the loader enforces the same ownership at read time.
  const importTriggers = presetData.trigger_words ?? [];
  const uniqueTriggers = selectUnclaimedTriggerWords(importTriggers, claimedTriggerWords, { lowercase: false });
  const matchingOfficialPreset =
    importMode === "bundle" ? null : await presetRepository.findMatchingOfficialPresetForImport(presetData);
  const createdAsPointer = matchingOfficialPreset !== null;
  const displayedTriggers = uniqueTriggers;
  const hasNoTriggers = displayedTriggers.length === 0;

  // Alters copy structural config from the main persona, so it must exist.
  const mainPersona = allPersonas.find((persona) => !persona.is_alter);
  if (!mainPersona) {
    return { ok: false, reason: "no_main_persona" };
  }

  // Resolve avatar fallbacks: a raw reference for persistence (storage URL or
  //    bot avatar) and a public display URL for embeds/thumbnails.
  const fallbackAvatarReference =
    guild?.members.me?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: true }) ??
    mainPersona.webhook_avatar_url ??
    client.user?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: true }) ??
    null;
  const fallbackAvatarDisplayUrl =
    guild?.members.me?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: true }) ??
    resolvePersonaAvatarPublicUrl(mainPersona.webhook_avatar_url) ??
    client.user?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: true }) ??
    null;

  const importedLineageId = presetData.persona_lineage_id ?? null;
  let newAlterRow: { persona_id?: number; persona_lineage_id?: number | string | bigint } | undefined;
  try {
    newAlterRow = matchingOfficialPreset
      ? ((await personaRepository.createPresetPointerAlterPersona({
          serverId: mainPersona.server_id,
          nickname: presetData.tomori_nickname,
          preset: matchingOfficialPreset,
          personaLineageId: identityMode === "preserve" ? importedLineageId : null,
          useFreshLineage: identityMode === "fork",
          triggerWords: uniqueTriggers,
          personaPrompt: typeof presetData.persona_prompt === "string" ? presetData.persona_prompt : null,
        })) ?? undefined)
      : ((await personaRepository.createAlterPersona({
          serverId: mainPersona.server_id,
          nickname: presetData.tomori_nickname,
          attributes: presetData.attribute_list,
          attributePublicFlags: presetData.attribute_public_flags,
          sampleDialoguesIn: presetData.sample_dialogues_in,
          sampleDialoguesOut: presetData.sample_dialogues_out,
          personaLineageId: identityMode === "preserve" ? importedLineageId : null,
          presetLineageId: importMode === "bundle" ? (presetData.preset_lineage_id ?? null) : null,
          namingConfig: importMode === "bundle" ? (presetData.naming_config ?? EMPTY_PERSONA_NAMING_CONFIG) : undefined,
          physicalAppearanceTags: presetData.physical_appearance_tags ?? [],
          charRefUrl: presetData.char_ref_url ?? null,
          naiAttgAuthor: presetData.nai_attg_author ?? null,
          naiAttgTitle: presetData.nai_attg_title ?? null,
          naiAttgTags: presetData.nai_attg_tags ?? null,
          naiAttgGenre: presetData.nai_attg_genre ?? null,
          naiAttgStars: presetData.nai_attg_stars ?? null,
          isNsfw: presetData.is_nsfw === true,
        })) ?? undefined);
  } catch (error) {
    // Surface a duplicate-name race as a friendly conflict; rethrow others.
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "name_conflict", name: presetData.tomori_nickname };
    }
    throw error;
  }

  if (!newAlterRow?.persona_id) {
    log.error("Failed to insert alter persona row");
    return { ok: false, reason: "insert_failed" };
  }
  const newTomoriId = newAlterRow.persona_id;

  // Persist the alter's trigger words + optional persona prompt. Pointer rows
  //    already carry their config from the official preset, so skip them.
  const importedPersonaPrompt = typeof presetData.persona_prompt === "string" ? presetData.persona_prompt : null;
  if (!createdAsPointer) {
    const personaConfigUpdated = await personaRepository.setPersonaConfig(
      newTomoriId,
      uniqueTriggers,
      importedPersonaPrompt,
    );
    if (!personaConfigUpdated) {
      return { ok: false, reason: "config_failed" };
    }
    if (
      !(await naturalNudgeRepository.savePersonaConfig(newTomoriId, {
        talkativeness: presetData.natural_nudge_talkativeness ?? DEFAULT_NATURAL_NUDGE_TALKATIVENESS,
        interests: presetData.natural_nudge_interests ?? [],
      }))
    ) {
      return { ok: false, reason: "config_failed" };
    }
    if (
      importedIdleNudges !== undefined &&
      (await naturalNudgeRepository.replacePersonaIdleNudges(newTomoriId, importedIdleNudges)) !== "success"
    ) {
      return { ok: false, reason: "config_failed" };
    }
  }

  if (
    !(await personaRepository.setVoiceConfig(
      newTomoriId,
      {
        speech_voice_design_prompt: presetData.speech_voice_design_prompt ?? null,
        voice_source_priority: presetData.voice_source_priority ?? "design",
        speech_voice_sample_id: null,
        speech_voice_id: null,
        speech_voice_name: null,
      },
      { materialize: Boolean(presetData.speech_voice_design_prompt) },
    ))
  )
    return { ok: false, reason: "config_failed" };
  invalidateTomoriStateCache(serverDiscId);

  if (presetData.lorebook_entries !== undefined) {
    const lineageId = Number(newAlterRow.persona_lineage_id);
    if (
      !Number.isSafeInteger(lineageId) ||
      (await lorebookRepository.replaceLineageEntries(
        mainPersona.server_id,
        lineageId,
        presetData.lorebook_entries,
      )) !== "replaced"
    ) {
      await personaRepository.removePersona(newTomoriId);
      invalidateTomoriStateCache(serverDiscId);
      return { ok: false, reason: "config_failed" };
    }
  }

  const usedMainAvatarFallback = !avatarImageBuffer && Boolean(fallbackAvatarReference);
  let avatarUrl: string | null;
  if (avatarImageBuffer) {
    avatarUrl = await uploadPersonaAvatarToStorage({
      personaId: newTomoriId,
      serverDiscId,
      label: "alter import",
      buffer: avatarImageBuffer,
    });
  } else {
    avatarUrl = fallbackAvatarReference;
  }

  if (avatarUrl) {
    const avatarUpdated = await personaRepository.setAvatar(newTomoriId, avatarUrl);
    if (!avatarUpdated) {
      log.warn(`Failed to persist imported avatar for alter persona ${newTomoriId}`);
    }
  } else {
    log.warn(`Failed to persist imported avatar for alter persona ${newTomoriId}`);
  }

  // Invalidate cache so the next message rebuilds with the new alter persona.
  invalidateTomoriStateCache(serverDiscId);

  log.success(
    `Successfully imported alter persona "${presetData.tomori_nickname}" with ${uniqueTriggers.length} triggers for ${serverDiscId}`,
  );

  return {
    ok: true,
    personaId: newTomoriId,
    nickname: presetData.tomori_nickname,
    displayedTriggers,
    uniqueTriggerCount: uniqueTriggers.length,
    usedMainAvatarFallback,
    hasNoTriggers,
    mainPersonaNickname: mainPersona.persona_nickname,
    fallbackAvatarDisplayUrl,
  };
}

function normalizePersonaName(name: string): string {
  return name.trim().toLowerCase();
}
