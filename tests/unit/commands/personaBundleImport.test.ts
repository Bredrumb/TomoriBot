import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import sharp from "sharp";
import { importPersona } from "@/commands/persona/import";
import { buildPersonaBundle } from "@/utils/persona/personaBundleArchive";
import * as bundleOperations from "@/utils/persona/personaBundleOperations";
import * as alterImport from "@/utils/persona/importAlterPreset";
import * as download from "@/utils/security/safeDownload";
import * as avatarStorage from "@/utils/storage/avatarStorage";
import { personaRepository, personaSpriteRepository, presetRepository } from "@/utils/db/repositories";
import { initializeLocalizer } from "@/utils/text/localizer";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { createPersona, createUserRow } from "../../helpers/fixtures";

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
});
beforeAll(initializeLocalizer);

describe("persona bundle import command", () => {
  it("restores validated bundle media for both import targets and stops before writes for invalid bundles", async () => {
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } })
      .png()
      .toBuffer();
    const main = createPersona({ persona_id: 7, persona_nickname: "Mirri", char_ref_url: "old-reference.png" });
    const alter = createPersona({ persona_id: 8, persona_nickname: "Juno", is_alter: true });
    const zip = await buildPersonaBundle({
      preset: {
        version: "1.0.0",
        type: "preset",
        exported_at: new Date().toISOString(),
        data: {
          tomori_nickname: "Juno",
          attribute_list: [],
          sample_dialogues_in: [],
          sample_dialogues_out: [],
          trigger_words: [],
        },
      },
      avatar: image,
      sprites: [],
      characterReference: null,
      voice: null,
    });
    const response = spyOn(download, "safeDownload").mockResolvedValue({ success: true, buffer: zip });
    const load = spyOn(personaRepository, "loadAllForServer").mockResolvedValue([main, alter]);
    const list = spyOn(personaSpriteRepository, "listForPersona").mockResolvedValue([]);
    const match = spyOn(presetRepository, "findMatchingOfficialPresetForImport").mockResolvedValue(null);
    const mainImport = spyOn(presetRepository, "importPresetData").mockResolvedValue({
      success: true,
      mainPersonaIsPointer: false,
      itemsImported: { nickname: "Juno", attributeCount: 0, dialogueCount: 0, triggerWordCount: 0 },
    });
    const alterPreset = spyOn(alterImport, "importAlterPreset").mockResolvedValue({
      ok: true,
      personaId: 8,
      nickname: "Juno",
      displayedTriggers: [],
      uniqueTriggerCount: 0,
      usedMainAvatarFallback: false,
      hasNoTriggers: true,
      mainPersonaNickname: "Mirri",
      fallbackAvatarDisplayUrl: null,
    });
    const restore = spyOn(bundleOperations, "restorePersonaBundleAssets").mockResolvedValue(true);
    const avatarUpload = spyOn(avatarStorage, "uploadPersonaAvatarToStorage").mockResolvedValue("import-avatar.png");
    const setAvatar = spyOn(personaRepository, "setAvatar").mockResolvedValue(true);
    restores.push(
      ...[response, load, list, match, mainImport, alterPreset, restore, avatarUpload, setAvatar].map(
        (spy) => () => spy.mockRestore(),
      ),
    );
    for (const type of ["main-failure", "main", "alter", "invalid"]) {
      const { interaction } = makeFakeInteraction({
        guild: type === "alter" ? { id: "workspace", members: { me: {} } } : null,
        memberPermissions: { has: () => true },
        options: {
          getString: (name) => (name === "type" ? (type === "alter" ? "alter" : "main") : null),
          getBoolean: () => null,
        },
        channel: { send: async () => undefined },
      });
      Object.assign(interaction.options, {
        getAttachment: () => ({ name: "persona.zip", url: "https://cdn.example.com/persona.zip", size: zip.length }),
      });
      restore.mockClear();
      mainImport.mockClear();
      alterPreset.mockClear();
      restore.mockResolvedValue(type !== "main-failure");
      if (type === "invalid") response.mockResolvedValue({ success: true, buffer: Buffer.from("invalid zip") });
      await importPersona(
        {} as Client,
        interaction as unknown as ChatInputCommandInteraction,
        createUserRow(),
        "en-US",
        { allowNsfw: false },
      );
      if (type === "invalid") {
        expect(mainImport).not.toHaveBeenCalled();
        expect(alterPreset).not.toHaveBeenCalled();
        expect(restore).not.toHaveBeenCalled();
      } else {
        expect(restore).toHaveBeenCalledTimes(1);
        expect(restore.mock.calls[0]?.[0].persona.persona_id).toBe(type.startsWith("main") ? 7 : 8);
        expect(restore.mock.calls[0]?.[0].bundle.avatar).toBeInstanceOf(Buffer);
        if (type.startsWith("main")) {
          expect(mainImport.mock.calls[0]?.[3]).toBe("bundle");
          expect(mainImport.mock.calls[0]?.[1].char_ref_url).toBe(main.char_ref_url);
          expect(restore.mock.calls[0]?.[0].previousCharRef).toBe(main.char_ref_url);
        } else {
          expect(alterPreset.mock.calls[0]?.[0].importMode).toBe("bundle");
        }
      }
    }
  });
});
