import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import sharp from "sharp";
import { configureSubcommand, execute } from "@/commands/persona/export";
import { lorebookEntryInputSchema } from "@/modules/lorebooks/db/types";
import {
  PRESET_EXPORT_VERSION,
  UNPAIRED_SAMPLE_DIALOGUE_SENTINEL,
  type PresetExport,
} from "@/types/preset/presetExport";
import { personaRepository, presetRepository, personaSpriteRepository } from "@/utils/db/repositories";
import { readPersonaBundle } from "@/utils/persona/personaBundleArchive";
import * as avatarHelper from "@/utils/image/avatarHelper";
import { extractMetadataFromPNG, extractSillyTavernMetadataFromPNG } from "@/utils/image/pngMetadata";
import { initializeLocalizer } from "@/utils/text/localizer";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";

const persona = createPersona({ persona_id: 1, persona_nickname: "Mirri" });
const preset: PresetExport = {
  version: PRESET_EXPORT_VERSION,
  type: "preset",
  exported_at: new Date().toISOString(),
  data: {
    tomori_nickname: persona.persona_nickname,
    attribute_list: ["{bot} watches the stars 🌟.", "{{char}} knows {{user}} and {user}."],
    sample_dialogues_in: ["Hello, {char}.", UNPAIRED_SAMPLE_DIALOGUE_SENTINEL],
    sample_dialogues_out: ["Hello, {user}.", "星空 over {{bot}}."],
    trigger_words: ["Mirri"],
    persona_prompt: "Speak as {bot} to {{user}}.",
    lorebook_entries: [
      lorebookEntryInputSchema.parse({
        title: "Observatory",
        content: "{bot} works here.",
        keys: ["observatory"],
        secondary_keys: ["night"],
        selective_logic: 2,
        scan_depth: 8,
        trigger_chance: 0,
        insertion_order: 42,
        placement: 1,
        constant: false,
        enabled: false,
        channel_disc_ids: [],
      }),
    ],
  },
};

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
});

beforeAll(initializeLocalizer);

describe("persona export", () => {
  it("blocks member exports privately by default and keeps every permitted guild format public", async () => {
    const avatar = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } })
      .png()
      .toBuffer();
    const load = spyOn(personaRepository, "loadAllForServer").mockResolvedValue([persona]);
    const exportData = spyOn(presetRepository, "exportPresetData").mockResolvedValue({ success: true, data: preset });
    const getAvatar = spyOn(avatarHelper, "getServerAvatar").mockResolvedValue(avatar);
    const listSprites = spyOn(personaSpriteRepository, "listForPersona").mockResolvedValue([]);
    restores.push(...[load, exportData, getAvatar, listSprites].map((spy) => () => spy.mockRestore()));
    for (const manager of [false, true]) {
      for (const enabled of [false, true]) {
        for (const format of ["tomoribot", "json", "sillytavern", "bundle"]) {
          const { interaction, calls } = makeFakeInteraction({
            guild: { id: "guild-1" },
            memberPermissions: { has: () => manager },
            options: {
              getString: (name) => (name === "output_format" ? format : String(persona.persona_id)),
              getBoolean: () => !enabled && !manager && format === "bundle",
            },
          });
          Object.assign(interaction, { attachmentSizeLimit: 10 * 1024 * 1024 });
          load.mockResolvedValue([
            createPersona({ ...persona, config: { ...persona.config, persona_export_enabled: enabled } }),
          ]);
          exportData.mockClear();
          getAvatar.mockClear();
          listSprites.mockClear();
          await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");
          if (!manager) expect(calls[0]?.args[0]).toEqual({ flags: MessageFlags.Ephemeral });
          if (!manager && !enabled) {
            expect(calls.map((call) => call.method)).toEqual(["deferReply", "editReply"]);
            expect(exportData).not.toHaveBeenCalled();
            expect(getAvatar).not.toHaveBeenCalled();
            expect(listSprites).not.toHaveBeenCalled();
            const reply = calls[1]?.args[0] as { embeds: Array<{ data: { title: string } }> };
            expect(reply.embeds[0]?.data.title).toContain(
              localizedCopy("en-US", "commands.persona.export.permission_denied_title"),
            );
          } else {
            expect(calls.map((call) => call.method)).toEqual(
              manager ? ["deferReply", "editReply"] : ["deferReply", "editReply", "followUp"],
            );
            const publicPayload = calls.at(-1)?.args[0] as { flags?: number; files: unknown[] };
            expect(publicPayload.flags).toBeUndefined();
            expect(publicPayload.files.length).toBeGreaterThan(0);
            if (manager) expect(calls[0]?.args[0]).toEqual({});
          }
        }
      }
    }
  });

  it("refuses a bundle that exceeds the interaction upload limit without attaching a partial export", async () => {
    const avatar = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } })
      .png()
      .toBuffer();
    const load = spyOn(personaRepository, "loadAllForServer").mockResolvedValue([persona]);
    const exportData = spyOn(presetRepository, "exportPresetData").mockResolvedValue({ success: true, data: preset });
    const getAvatar = spyOn(avatarHelper, "getServerAvatar").mockResolvedValue(avatar);
    const listSprites = spyOn(personaSpriteRepository, "listForPersona").mockResolvedValue([]);
    restores.push(...[load, exportData, getAvatar, listSprites].map((spy) => () => spy.mockRestore()));
    const { interaction, calls } = makeFakeInteraction({
      options: {
        getString: (name) => (name === "output_format" ? "bundle" : String(persona.persona_id)),
        getBoolean: () => false,
      },
    });
    Object.assign(interaction, { attachmentSizeLimit: 16 });
    await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");
    expect(calls.map((call) => call.method)).toEqual(["deferReply", "editReply"]);
    const reply = calls[1]?.args[0] as { files?: unknown[]; embeds: Array<{ data: { title: string } }> };
    expect(reply.files?.length ?? 0).toBe(0);
    expect(reply.embeds[0]?.data.title).toContain(localizedCopy("en-US", "commands.persona.export.failed_title"));
  });

  it("registers the required format choices in their display order", () => {
    const command = configureSubcommand(new SlashCommandSubcommandBuilder()).toJSON();
    const format = command.options?.find((option) => option.name === "output_format");
    expect(format?.required).toBe(true);
    expect(format && "choices" in format ? format.choices : undefined).toEqual(
      ["tomoribot", "json", "sillytavern", "bundle"].map((value) => ({
        name: localizedCopy("en-US", `commands.persona.export.${value}_option`),
        value,
      })),
    );
    expect(command.options?.some((option) => option.name === "export_json")).toBe(false);
  });

  it("maps Unicode, placeholders, paired and unpaired examples, and lore activation settings to V2", () => {
    const card = presetRepository.convertPresetDataToSillyTavernCard(preset.data);
    expect(card.spec).toBe("chara_card_v2");
    expect(card.spec_version).toBe("2.0");
    expect(card.data.name).toBe(preset.data.tomori_nickname);
    expect(card.data.description).toBe("{{char}} watches the stars 🌟.\n\n{{char}} knows {{user}} and {{user}}.");
    expect(card.data.system_prompt).toBe("Speak as {{char}} to {{user}}.");
    expect(card.data.mes_example).toBe(
      "<START>\n{{user}}: Hello, {{char}}.\n{{char}}: Hello, {{user}}.\n\n<START>\n{{char}}: 星空 over {{char}}.",
    );
    expect(card.data.first_mes).toBe("");
    expect(card.data.extensions).toEqual({});
    expect(card.data).not.toHaveProperty("trigger_words");
    expect(card.data.character_book?.entries[0]).toMatchObject({
      enabled: false,
      constant: false,
      keys: ["observatory"],
      secondary_keys: ["night"],
      content: "{{char}} works here.",
      insertion_order: 42,
      position: "after_char",
      extensions: { selectiveLogic: 2, scan_depth: 8, probability: 0, useProbability: true, position: 1 },
    });
    const imported = presetRepository.convertSillyTavernJsonToPresetData(card);
    expect(imported.success).toBe(true);
    if (!imported.success) throw new Error("Expected exported card to be importable");
    expect(imported.data.sample_dialogues_in[1]).toBe(UNPAIRED_SAMPLE_DIALOGUE_SENTINEL);
    expect(imported.data.lorebook_entries?.[0]).toMatchObject({
      ...preset.data.lorebook_entries?.[0],
      content: "{{char}} works here.",
    });
  });

  it("exports the selected format after acknowledging and preserves the PNG avatar pixels", async () => {
    const avatar = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } })
      .png()
      .toBuffer();
    const load = spyOn(personaRepository, "loadAllForServer").mockImplementation(async () => [persona]);
    const exportData = spyOn(presetRepository, "exportPresetData").mockResolvedValue({ success: true, data: preset });
    const getAvatar = spyOn(avatarHelper, "getServerAvatar").mockResolvedValue(avatar);
    const listSprites = spyOn(personaSpriteRepository, "listForPersona").mockResolvedValue([]);
    restores.push(
      () => load.mockRestore(),
      () => exportData.mockRestore(),
      () => getAvatar.mockRestore(),
      () => listSprites.mockRestore(),
    );
    for (const format of ["tomoribot", "json", "sillytavern", "bundle"]) {
      const { interaction, calls } = makeFakeInteraction({
        options: {
          getString: (name) => (name === "output_format" ? format : String(persona.persona_id)),
          getBoolean: () => null,
        },
      });
      Object.assign(interaction, { attachmentSizeLimit: 10 * 1024 * 1024 });
      load.mockImplementation(async () => {
        expect(interaction.deferred).toBe(true);
        return [persona];
      });
      getAvatar.mockClear();
      await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");
      expect(calls.map((call) => call.method)).toEqual(["deferReply", "editReply"]);
      expect(exportData).toHaveBeenLastCalledWith(interaction.user.id, persona.persona_id);
      const reply = calls[1]?.args[0] as { files: AttachmentBuilder[] };
      const attachment = reply.files[0];
      expect(attachment).toBeInstanceOf(AttachmentBuilder);
      expect(Buffer.isBuffer(attachment?.attachment)).toBe(true);
      const bytes = attachment?.attachment as Buffer;
      if (format === "json") {
        expect(getAvatar).not.toHaveBeenCalled();
        expect(attachment?.name).toEndWith(".json");
        expect(JSON.parse(bytes.toString("utf8"))).toMatchObject(preset);
      } else if (format === "bundle") {
        expect(attachment?.name).toEndWith(".zip");
        const bundle = await readPersonaBundle(bytes);
        expect(bundle.preset.data.tomori_nickname).toBe(preset.data.tomori_nickname);
        expect(bundle.voice).toBeNull();
        expect(await sharp(bundle.avatar).raw().toBuffer()).toEqual(await sharp(avatar).raw().toBuffer());
      } else {
        expect(attachment?.name).toEndWith(".png");
        expect(await sharp(bytes).raw().toBuffer()).toEqual(await sharp(avatar).raw().toBuffer());
        if (format === "tomoribot") {
          expect(extractMetadataFromPNG(bytes)).toEqual(preset);
          expect(extractSillyTavernMetadataFromPNG(bytes)).toBeNull();
        } else {
          const metadata = extractSillyTavernMetadataFromPNG(bytes);
          expect(metadata?.metadataKey).toBe("chara");
          expect(metadata?.decodedFromBase64).toBe(true);
          expect(metadata?.parsedJson).toEqual(presetRepository.convertPresetDataToSillyTavernCard(preset.data));
          expect(extractMetadataFromPNG(bytes)).toBeNull();
        }
      }
    }
  });
});
