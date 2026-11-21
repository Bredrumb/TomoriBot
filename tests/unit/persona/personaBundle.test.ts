import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { randomFillSync } from "node:crypto";
import JSZip from "jszip";
import sharp from "sharp";
import { personaSpriteSchema } from "@/types/db/schema";
import { PRESET_EXPORT_VERSION, type PresetExport } from "@/types/preset/presetExport";
import { buildPersonaBundle, readPersonaBundle, optimizeBundleImage } from "@/utils/persona/personaBundleArchive";
import { exportPersonaBundle, restorePersonaBundleAssets } from "@/utils/persona/personaBundleOperations";
import { personaRepository, personaSpriteRepository } from "@/utils/db/repositories";
import * as speechRepository from "@/utils/db/repositories/SpeechRepository";
import * as avatarStorage from "@/utils/storage/avatarStorage";
import * as charrefStorage from "@/utils/storage/charrefStorage";
import * as voiceStorage from "@/utils/storage/voiceSampleStorage";
import { createPersona } from "../../helpers/fixtures";

const persona = createPersona({ persona_id: 7, persona_nickname: "Mirri", char_ref_url: null });
const sprite = personaSpriteSchema.parse({
  persona_id: 7,
  sprite_name: "happy",
  sprite_key: "happy",
  avatar_url: "data/avatars/happy.png",
  usage_instructions: "When pleased",
  is_identity: true,
});
const preset: PresetExport = {
  version: PRESET_EXPORT_VERSION,
  type: "preset",
  exported_at: new Date().toISOString(),
  data: {
    tomori_nickname: persona.persona_nickname,
    attribute_list: ["A stargazer"],
    sample_dialogues_in: [],
    sample_dialogues_out: [],
    trigger_words: ["Mirri"],
    char_ref_url: "data/charrefs/source.png",
  },
};
const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
});

async function png(): Promise<Buffer> {
  return await sharp({ create: { width: 8, height: 8, channels: 4, background: "#33669980" } })
    .png()
    .toBuffer();
}

function wav(): Buffer {
  const bytes = Buffer.alloc(44 + 22050 * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(22050, 24);
  bytes.writeUInt32LE(44100, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}

async function archive(): Promise<Buffer> {
  const image = await png();
  return await buildPersonaBundle({
    preset,
    avatar: image,
    sprites: [{ sprite, pngBuffer: image }],
    characterReference: image,
    voice: { name: "Mirri", ref_text: "星空", buffer: wav(), durationMs: 1000 },
  });
}

describe("persona bundles", () => {
  it("stores simultaneous sprite uploads separately even when their timestamps match", async () => {
    const timestamp = Date.now();
    const frozenTime = spyOn(Date, "now").mockReturnValue(timestamp);
    const references: string[] = [];
    try {
      const buffers = [
        await png(),
        await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
          .png()
          .toBuffer(),
      ];
      for (const buffer of buffers) {
        const reference = await avatarStorage.uploadPersonaSpriteToStorage({
          personaId: 7,
          serverDiscId: `bundle-test-${timestamp}`,
          buffer,
        });
        if (!reference) throw new Error("Expected local sprite upload");
        references.push(reference);
      }
      expect(new Set(references).size).toBe(buffers.length);
      for (const [index, reference] of references.entries())
        expect(await avatarStorage.loadStoredPersonaAvatarBuffer(reference)).toEqual(buffers[index]);
    } finally {
      frozenTime.mockRestore();
      await Promise.all(references.map((reference) => avatarStorage.deletePersonaSpriteFromStorage(reference)));
    }
  });

  it("round-trips sprites, reference pixels, voice transcript and voice duration without source storage references", async () => {
    const bundle = await readPersonaBundle(await archive());
    expect(bundle.preset.data.tomori_nickname).toBe(preset.data.tomori_nickname);
    expect(bundle.preset.data.char_ref_url).toBeNull();
    expect(bundle.sprites[0]?.meta).toMatchObject({
      sprite_key: sprite.sprite_key,
      usage_instructions: sprite.usage_instructions,
      is_identity: true,
    });
    expect(await sharp(bundle.avatar).raw().toBuffer()).toEqual(
      await sharp(await png())
        .raw()
        .toBuffer(),
    );
    if (!bundle.characterReference) throw new Error("Expected a bundled character reference");
    expect(await sharp(bundle.characterReference).raw().toBuffer()).toEqual(
      await sharp(await png())
        .raw()
        .toBuffer(),
    );
    expect(bundle.voice).toMatchObject({ name: "Mirri", ref_text: "星空", durationMs: 1000 });
    expect(bundle.voice?.buffer.subarray(0, 4).toString()).toBe("RIFF");
    expect(preset.data.char_ref_url).not.toBeNull();
  });

  it("resizes oversized image copies while preserving transparency and the source bytes", async () => {
    const pixels = randomFillSync(Buffer.alloc(1024 * 1024 * 4));
    const original = await sharp(pixels, { raw: { width: 1024, height: 1024, channels: 4 } })
      .png()
      .toBuffer();
    const snapshot = Buffer.from(original);
    const optimized = await optimizeBundleImage(original);
    expect(optimized.length).toBeLessThanOrEqual(1024 * 1024);
    expect((await sharp(optimized).metadata()).width).toBeLessThan(1024);
    expect((await sharp(optimized).metadata()).hasAlpha).toBe(true);
    expect(original).toEqual(snapshot);
  });

  it("rejects missing, undeclared, invalid, and oversized expanded assets before returning import data", async () => {
    const original = await archive();
    for (const mutate of [
      (zip: JSZip) => zip.remove("avatar.png"),
      (zip: JSZip) => zip.file("extra.bin", "unexpected"),
      (zip: JSZip) => zip.file("avatar.png", Buffer.from("invalid image")),
      (zip: JSZip) => zip.file("persona.json", Buffer.alloc(3 * 1024 * 1024)),
      (zip: JSZip) => zip.file("voice.wav", Buffer.from("invalid audio")),
      (zip: JSZip) => zip.file("manifest.json", JSON.stringify({ type: "tomoribot_persona_bundle", version: 2 })),
    ]) {
      const zip = await JSZip.loadAsync(original);
      mutate(zip);
      await expect(
        readPersonaBundle(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })),
      ).rejects.toThrow();
    }
  });

  it("includes assigned voice audio only when requested and refuses missing sprite assets", async () => {
    const image = await png();
    const list = spyOn(personaSpriteRepository, "listForPersona").mockResolvedValue([]);
    const sample = spyOn(speechRepository, "loadVoiceSampleById").mockResolvedValue({
      sample_id: 11,
      server_id: persona.server_id,
      name: "Mirri",
      file_path: "voice.wav",
      ref_text: "Hello",
      duration_ms: 1000,
    });
    const audio = spyOn(voiceStorage, "loadStoredVoiceSampleBuffer").mockResolvedValue(wav());
    const loadImage = spyOn(avatarStorage, "loadStoredPersonaAvatarBuffer").mockResolvedValue(null);
    restores.push(
      () => list.mockRestore(),
      () => sample.mockRestore(),
      () => audio.mockRestore(),
      () => loadImage.mockRestore(),
    );
    const input = { persona: { ...persona, speech_voice_sample_id: 11 }, preset, avatar: image };
    expect((await readPersonaBundle(await exportPersonaBundle({ ...input, includeVoice: false }))).voice).toBeNull();
    expect(sample).not.toHaveBeenCalled();
    expect((await readPersonaBundle(await exportPersonaBundle({ ...input, includeVoice: true }))).voice?.ref_text).toBe(
      "Hello",
    );
    sample.mockResolvedValue({
      sample_id: 11,
      server_id: persona.server_id + 1,
      name: "Juno",
      file_path: "voice.wav",
      duration_ms: 1000,
    });
    await expect(exportPersonaBundle({ ...input, includeVoice: true })).rejects.toThrow();
    list.mockResolvedValue([sprite]);
    await expect(exportPersonaBundle({ ...input, includeVoice: false })).rejects.toThrow();
  });

  it("cleans staged assets on a failed transaction and retires previous assets only after success", async () => {
    const bundle = await readPersonaBundle(await archive());
    const events: string[] = [];
    const uploadSprite = spyOn(avatarStorage, "uploadPersonaSpriteToStorage").mockResolvedValue("new-sprite.png");
    const deleteSprite = spyOn(avatarStorage, "deletePersonaSpriteFromStorage").mockImplementation(async (ref) => {
      events.push(`delete:${ref}`);
      return true;
    });
    const uploadRef = spyOn(charrefStorage, "uploadCharRef").mockResolvedValue("new-ref.png");
    const deleteRef = spyOn(charrefStorage, "deleteCharRef").mockResolvedValue(true);
    const insert = spyOn(speechRepository, "insertVoiceSample").mockResolvedValue(22);
    const update = spyOn(speechRepository, "updateVoiceSamplePath").mockResolvedValue(undefined);
    const deleteRow = spyOn(speechRepository, "deleteVoiceSample").mockResolvedValue(undefined);
    const storeAudio = spyOn(voiceStorage, "storeVoiceSample").mockResolvedValue("new-voice.wav");
    const deleteAudio = spyOn(voiceStorage, "deleteStoredVoiceSample").mockResolvedValue(true);
    const save = spyOn(personaRepository, "replaceBundleAssets").mockImplementation(async () => {
      events.push("write");
      return false;
    });
    restores.push(
      ...[
        uploadSprite,
        deleteSprite,
        uploadRef,
        deleteRef,
        insert,
        update,
        deleteRow,
        storeAudio,
        deleteAudio,
        save,
      ].map((spy) => () => spy.mockRestore()),
    );
    const input = {
      persona,
      serverDiscId: "workspace",
      bundle,
      previousSprites: [sprite],
      previousCharRef: "old-reference.png",
    };
    expect(await restorePersonaBundleAssets(input)).toBe(false);
    expect(events).toEqual(["write", "delete:new-sprite.png"]);
    expect(deleteRef).toHaveBeenCalledWith("new-ref.png", "personas", persona.persona_id);
    expect(deleteRef).not.toHaveBeenCalledWith("old-reference.png", "personas", persona.persona_id);
    expect(deleteAudio).toHaveBeenCalledWith("new-voice.wav");
    expect(deleteRow).toHaveBeenCalledWith(22);
    events.length = 0;
    save.mockImplementation(async () => {
      events.push("write");
      return true;
    });
    expect(await restorePersonaBundleAssets(input)).toBe(true);
    expect(deleteRef).toHaveBeenCalledWith("old-reference.png", "personas", persona.persona_id);
    expect(events).toEqual(["write", `delete:${sprite.avatar_url}`]);
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      charRefUrl: "new-ref.png",
      voice: { sampleId: 22, name: "Mirri" },
      sprites: [{ avatar_url: "new-sprite.png", sprite_key: "happy" }],
    });
  });
});
