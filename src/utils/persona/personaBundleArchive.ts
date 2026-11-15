import JSZip from "jszip";
import sharp from "sharp";
import { parseBuffer } from "music-metadata";
import { z } from "zod";
import { presetExportSchema, type PresetExport } from "@/types/preset/presetExport";
import { buildSpriteArchive, readSpriteArchive, type SpriteArchiveBuildEntry } from "@/utils/persona/spriteArchive";
import { PERSONA_SPRITE_LIMITS, validatePersonaSpriteName } from "@/utils/persona/sprites";
import { IMPORT_LIMITS } from "@/utils/security/rateLimiter";
import {
  SPEECH_SAMPLE_MAX_MB,
  SPEECH_SAMPLE_MAX_DURATION_SECS,
  normalizeVoiceSampleToWav,
} from "@/utils/speech/voiceSampleAddOperation";
import { getDeclaredUncompressedSize } from "@/utils/zip/zipEntryGuards";

export const PERSONA_BUNDLE_MAX_BYTES = IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB * 1024 * 1024;
const IMAGE_MAX_BYTES = 1024 * 1024;
const IMAGE_MAX_PIXELS = 4096 * 4096;
const VOICE_MAX_BYTES = SPEECH_SAMPLE_MAX_MB * 1024 * 1024;
const CARD_MAX_BYTES = 2 * 1024 * 1024;
const SPRITES_MAX_BYTES = PERSONA_SPRITE_LIMITS.MAX_PER_PERSONA * (IMAGE_MAX_BYTES + 4096);

const voiceMetadataSchema = z.object({
  name: z.string().min(1).max(128),
  ref_text: z.string().max(16_003).nullable(),
});
const manifestSchema = z.object({
  type: z.literal("tomoribot_persona_bundle"),
  version: z.literal(1),
  sprites: z.boolean(),
  character_reference: z.boolean(),
  voice: voiceMetadataSchema.nullable(),
});

export type PersonaBundleVoice = z.infer<typeof voiceMetadataSchema> & { buffer: Buffer; durationMs: number };
export type PersonaBundle = {
  preset: PresetExport;
  avatar: Buffer;
  sprites: Array<{
    meta: {
      sprite_name: string;
      sprite_key: string;
      usage_instructions: string;
      is_identity: boolean;
    };
    pngBuffer: Buffer;
  }>;
  characterReference: Buffer | null;
  voice: PersonaBundleVoice | null;
};

export async function optimizeBundleImage(buffer: Buffer): Promise<Buffer> {
  const encode = (cap?: number) => {
    const pipeline = sharp(buffer, { limitInputPixels: IMAGE_MAX_PIXELS });
    if (cap) pipeline.resize(cap, cap, { fit: "inside", withoutEnlargement: true });
    return pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  };
  let result = await encode();
  for (let cap = 768; result.length > IMAGE_MAX_BYTES && cap >= 96; cap = Math.floor(cap * 0.85)) {
    const resized = await encode(cap);
    if (resized.length < result.length) result = resized;
  }
  if (result.length > IMAGE_MAX_BYTES) throw new Error("Persona bundle image exceeds its byte budget");
  return result;
}

export async function buildPersonaBundle(input: {
  preset: PresetExport;
  avatar: Buffer;
  sprites: SpriteArchiveBuildEntry[];
  characterReference: Buffer | null;
  voice: PersonaBundleVoice | null;
}): Promise<Buffer> {
  const zip = new JSZip();
  const card = JSON.stringify({ ...input.preset, data: { ...input.preset.data, char_ref_url: null } });
  if (Buffer.byteLength(card) > CARD_MAX_BYTES) throw new Error("Persona bundle card exceeds its byte budget");
  zip.file("persona.json", card);
  zip.file("avatar.png", await optimizeBundleImage(input.avatar));
  if (input.sprites.length > PERSONA_SPRITE_LIMITS.MAX_PER_PERSONA) throw new Error("Too many bundle sprites");
  if (input.sprites.length > 0) {
    const entries: SpriteArchiveBuildEntry[] = [];
    for (const entry of input.sprites)
      entries.push({ ...entry, pngBuffer: await optimizeBundleImage(entry.pngBuffer) });
    const archive = await buildSpriteArchive({
      personaId: input.sprites[0].sprite.persona_id,
      personaNickname: input.preset.data.tomori_nickname,
      entries,
    });
    zip.file("sprites.zip", archive.buffer, { compression: "STORE" });
  }
  if (input.characterReference)
    zip.file("character-reference.png", await optimizeBundleImage(input.characterReference));
  if (input.voice) {
    if (input.voice.buffer.length > VOICE_MAX_BYTES) throw new Error("Bundle voice sample exceeds its byte budget");
    zip.file("voice.wav", input.voice.buffer);
  }
  zip.file(
    "manifest.json",
    JSON.stringify(
      manifestSchema.parse({
        type: "tomoribot_persona_bundle",
        version: 1,
        sprites: input.sprites.length > 0,
        character_reference: input.characterReference !== null,
        voice: input.voice ? { name: input.voice.name, ref_text: input.voice.ref_text } : null,
      }),
    ),
  );
  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function readPersonaBundle(buffer: Buffer): Promise<PersonaBundle> {
  if (buffer.length > PERSONA_BUNDLE_MAX_BYTES) throw new Error("Persona bundle exceeds import limit");
  const zip = await JSZip.loadAsync(buffer);
  if (Object.keys(zip.files).length > 6) throw new Error("Persona bundle contains too many files");
  const read = async (name: string, maxBytes: number): Promise<Buffer> => {
    const file = zip.file(name);
    if (!file || file.dir) throw new Error("Persona bundle is missing an asset");
    const declared = getDeclaredUncompressedSize(file);
    if (declared === null || declared > maxBytes) throw new Error("Persona bundle asset exceeds expanded limit");
    const bytes = await file.async("nodebuffer");
    if (bytes.length > maxBytes) throw new Error("Persona bundle asset exceeds expanded limit");
    return bytes;
  };
  const manifest = manifestSchema.parse(JSON.parse((await read("manifest.json", 64 * 1024)).toString("utf8")));
  const allowed = new Set([
    "manifest.json",
    "persona.json",
    "avatar.png",
    ...(manifest.sprites ? ["sprites.zip"] : []),
    ...(manifest.character_reference ? ["character-reference.png"] : []),
    ...(manifest.voice ? ["voice.wav"] : []),
  ]);
  if (Object.values(zip.files).some((file) => file.dir || !allowed.has(file.name))) {
    throw new Error("Persona bundle contains undeclared assets");
  }
  const preset = presetExportSchema.parse(JSON.parse((await read("persona.json", CARD_MAX_BYTES)).toString("utf8")));
  preset.data.char_ref_url = null;
  const validateImage = async (bytes: Buffer): Promise<Buffer> => {
    const image = sharp(bytes, { limitInputPixels: IMAGE_MAX_PIXELS });
    if ((await image.metadata()).format !== "png") throw new Error("Bundle image is not PNG");
    await image.stats();
    return bytes;
  };
  const avatar = await validateImage(await read("avatar.png", IMAGE_MAX_BYTES));
  const characterReference = manifest.character_reference
    ? await validateImage(await read("character-reference.png", IMAGE_MAX_BYTES))
    : null;
  const sprites: PersonaBundle["sprites"] = [];
  if (manifest.sprites) {
    const archive = await readSpriteArchive(await read("sprites.zip", SPRITES_MAX_BYTES), {
      maxEntries: PERSONA_SPRITE_LIMITS.MAX_PER_PERSONA,
      maxFileBytes: IMAGE_MAX_BYTES,
      maxTotalBytes: PERSONA_SPRITE_LIMITS.MAX_PER_PERSONA * IMAGE_MAX_BYTES,
    });
    if (!archive.ok) throw new Error(`Invalid bundle sprites: ${archive.reason}`);
    const keys = new Set<string>();
    for (const entry of archive.entries) {
      const name = validatePersonaSpriteName(entry.meta.sprite_name);
      if (!name.ok || name.spriteKey !== entry.meta.sprite_key || keys.has(name.spriteKey)) {
        throw new Error("Invalid or duplicate bundle sprite name");
      }
      keys.add(name.spriteKey);
      sprites.push({ meta: entry.meta, pngBuffer: await validateImage(entry.pngBuffer) });
    }
  }
  let voice: PersonaBundleVoice | null = null;
  if (manifest.voice) {
    const bytes = await read("voice.wav", VOICE_MAX_BYTES);
    if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("Bundle voice sample is not WAV");
    }
    const metadata = await parseBuffer(bytes, { mimeType: "audio/wav" });
    const duration = metadata.format.duration;
    if (!duration || !Number.isFinite(duration) || duration > SPEECH_SAMPLE_MAX_DURATION_SECS) {
      throw new Error("Invalid bundle voice duration");
    }
    voice = {
      ...manifest.voice,
      durationMs: Math.round(duration * 1000),
      buffer: await normalizeVoiceSampleToWav(bytes, undefined, VOICE_MAX_BYTES),
    };
  }
  return { preset, avatar, sprites, characterReference, voice };
}
