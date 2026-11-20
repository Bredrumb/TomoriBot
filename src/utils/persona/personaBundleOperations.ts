import type { PersonaSpriteRow, TomoriState } from "@/types/db/schema";
import type { PresetExport } from "@/types/preset/presetExport";
import { personaRepository, personaSpriteRepository } from "@/utils/db/repositories";
import {
  loadVoiceSampleById,
  insertVoiceSample,
  updateVoiceSamplePath,
  deleteVoiceSample,
} from "@/utils/db/repositories/SpeechRepository";
import { log } from "@/utils/misc/logger";
import { memoryGuard } from "@/utils/security/rateLimiter";
import {
  loadStoredPersonaAvatarBuffer,
  uploadPersonaSpriteToStorage,
  deletePersonaSpriteFromStorage,
  isSharedPresetAssetReference,
} from "@/utils/storage/avatarStorage";
import { loadCharRefAsBase64, uploadCharRef, deleteCharRef } from "@/utils/storage/charrefStorage";
import {
  loadStoredVoiceSampleBuffer,
  storeVoiceSample,
  deleteStoredVoiceSample,
} from "@/utils/storage/voiceSampleStorage";
import { buildPersonaBundle, type PersonaBundle, type PersonaBundleVoice } from "@/utils/persona/personaBundleArchive";
import type { SpriteArchiveBuildEntry } from "@/utils/persona/spriteArchive";

export async function exportPersonaBundle(input: {
  persona: TomoriState;
  preset: PresetExport;
  avatar: Buffer;
  includeVoice: boolean;
}): Promise<Buffer> {
  const personaId = input.persona.persona_id;
  if (!personaId || memoryGuard.checkMemory().status === "critical") throw new Error("Bundle export is unavailable");
  const sprites: SpriteArchiveBuildEntry[] = [];
  for (const sprite of await personaSpriteRepository.listForPersona(personaId)) {
    const buffer = await loadStoredPersonaAvatarBuffer(sprite.avatar_url);
    if (!buffer) throw new Error("Bundle sprite could not be loaded");
    sprites.push({ sprite, pngBuffer: buffer });
  }
  let characterReference: Buffer | null = null;
  if (input.persona.char_ref_url) {
    const base64 = await loadCharRefAsBase64(input.persona.char_ref_url, "personas", personaId);
    if (!base64) throw new Error("Bundle character reference could not be loaded");
    characterReference = Buffer.from(base64, "base64");
  }
  let voice: PersonaBundleVoice | null = null;
  if (input.includeVoice && input.persona.speech_voice_sample_id) {
    const sample = await loadVoiceSampleById(input.persona.speech_voice_sample_id);
    if (!sample || sample.server_id !== input.persona.server_id) throw new Error("Bundle voice sample is unavailable");
    const buffer = await loadStoredVoiceSampleBuffer(sample.file_path);
    if (!buffer) throw new Error("Bundle voice sample could not be loaded");
    voice = { name: sample.name, ref_text: sample.ref_text ?? null, durationMs: sample.duration_ms, buffer };
  }
  return await buildPersonaBundle({ preset: input.preset, avatar: input.avatar, sprites, characterReference, voice });
}

export async function restorePersonaBundleAssets(input: {
  persona: TomoriState;
  serverDiscId: string;
  bundle: PersonaBundle;
  previousSprites?: PersonaSpriteRow[];
  previousCharRef?: string | null;
}): Promise<boolean> {
  const personaId = input.persona.persona_id;
  if (!personaId) return false;
  const uploadedSprites: string[] = [];
  let charRefUrl: string | null = null;
  let sampleId: number | null = null;
  let samplePath: string | null = null;
  try {
    const previousSprites = input.previousSprites ?? (await personaSpriteRepository.listForPersona(personaId));
    const sprites: Parameters<typeof personaRepository.replaceBundleAssets>[0]["sprites"] = [];
    for (const entry of input.bundle.sprites) {
      const reference = await uploadPersonaSpriteToStorage({
        personaId,
        serverDiscId: input.serverDiscId,
        label: entry.meta.sprite_key,
        buffer: entry.pngBuffer,
      });
      if (!reference) throw new Error("Bundle sprite upload failed");
      uploadedSprites.push(reference);
      sprites.push({ ...entry.meta, avatar_url: reference });
    }
    if (input.bundle.characterReference) {
      charRefUrl = await uploadCharRef({
        entityType: "personas",
        entityId: personaId,
        buffer: input.bundle.characterReference,
      });
      if (!charRefUrl) throw new Error("Bundle character reference upload failed");
    }
    if (input.bundle.voice) {
      const voice = input.bundle.voice;
      sampleId = await insertVoiceSample(input.persona.server_id, voice.name, voice.ref_text, voice.durationMs);
      if (!sampleId) throw new Error("Bundle voice sample insert failed");
      samplePath = await storeVoiceSample({ serverId: input.persona.server_id, sampleId, buffer: voice.buffer });
      if (!samplePath) throw new Error("Bundle voice sample upload failed");
      await updateVoiceSamplePath(sampleId, samplePath);
    }
    const saved = await personaRepository.replaceBundleAssets({
      personaId,
      serverDiscId: input.serverDiscId,
      sprites,
      charRefUrl,
      voice: sampleId && input.bundle.voice ? { sampleId, name: input.bundle.voice.name } : null,
    });
    if (!saved) throw new Error("Bundle asset transaction failed");
    const previousCharRef = input.previousCharRef === undefined ? input.persona.char_ref_url : input.previousCharRef;
    const cleanup = await Promise.allSettled([
      ...previousSprites
        .filter((sprite) => !isSharedPresetAssetReference(sprite.avatar_url))
        .map((sprite) => deletePersonaSpriteFromStorage(sprite.avatar_url)),
      ...(previousCharRef && !isSharedPresetAssetReference(previousCharRef)
        ? [deleteCharRef(previousCharRef, "personas", personaId)]
        : []),
    ]);
    if (cleanup.some((result) => result.status === "rejected" || !result.value)) {
      log.warn("Persona bundle restored with previous sprite storage cleanup failures", undefined, { personaId });
    }
    return true;
  } catch (error) {
    log.error("Persona bundle asset restore failed", error, {
      personaId,
      metadata: { serverDiscId: input.serverDiscId },
    });
    const cleanup = await Promise.allSettled([
      ...uploadedSprites.map((reference) => deletePersonaSpriteFromStorage(reference)),
      ...(charRefUrl ? [deleteCharRef(charRefUrl, "personas", personaId)] : []),
      ...(samplePath ? [deleteStoredVoiceSample(samplePath)] : []),
      ...(sampleId ? [deleteVoiceSample(sampleId)] : []),
    ]);
    if (cleanup.some((result) => result.status === "rejected" || result.value === false)) {
      log.warn("Persona bundle staging cleanup was incomplete", undefined, { personaId });
    }
    return false;
  }
}
