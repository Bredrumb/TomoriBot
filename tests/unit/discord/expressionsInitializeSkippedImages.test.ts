import { afterEach, beforeAll, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { execute } from "@/commands/expressions/initialize";
import { savedProviderConfigSchema, serverEmojiSchema } from "@/types/db/schema";
import * as featureExecutors from "@/providers/utils/providerFeatureExecutors";
import * as emojiSync from "@/utils/cache/emojiLazySync";
import * as stickerSync from "@/utils/cache/stickerLazySync";
import * as expressionCache from "@/utils/cache/emojiStickerCache";
import { personaRepository, serverRepository } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import * as credentials from "@/utils/provider/credentialResolver";
import * as personalRuntime from "@/utils/provider/personalProviderRuntime";
import * as textSelection from "@/utils/provider/textModelSelection";
import { initializeLocalizer } from "@/utils/text/localizer";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";

const cleanups: Array<() => void> = [];
beforeAll(initializeLocalizer);
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

it("initializes available expressions without allowing model results to write skipped images", async () => {
  const state = createPersona({
    llm: createLlmRow({ llm_provider: "anthropic", llm_codename: "claude-sonnet-5-5", supports_structoutput: true }),
  });
  const emojis = ["Mirri", "Juno"].map((name, index) =>
    serverEmojiSchema.parse({ server_id: state.server_id, emoji_disc_id: String(index + 1), emoji_name: name }),
  );
  const savedConfig = savedProviderConfigSchema.parse({
    server_id: state.server_id,
    provider: "anthropic",
    api_key: Buffer.from("fixture-encrypted-key"),
    llm_id: state.llm.llm_id,
    diffusion_model_id: null,
    embedding_model_id: null,
    nai_diffusion_model_id: null,
    nai_preset_name: null,
  });
  const mocks = [
    spyOn(personaRepository, "loadState").mockResolvedValue(state),
    spyOn(personalRuntime, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
      tomoriState: state,
      activeConfigs: {},
    }),
    spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
      provider: "anthropic",
      apiKey: "fixture-key",
      keyVersion: 1,
      savedConfig,
      source: "server",
    }),
    spyOn(textSelection, "resolveTextCredentialState").mockResolvedValue(state),
    spyOn(emojiSync, "lazySyncGuildEmojis").mockResolvedValue(true),
    spyOn(stickerSync, "lazySyncGuildStickers").mockResolvedValue(true),
    spyOn(serverRepository, "loadEmojisForClassification").mockImplementation(async () =>
      emojis.filter((emoji) => !emoji.emoji_desc),
    ),
    spyOn(serverRepository, "loadStickersForClassification").mockResolvedValue([]),
    spyOn(expressionCache, "invalidateEmojiStickerCache").mockImplementation(() => {}),
    spyOn(log, "info").mockImplementation(() => {}),
    spyOn(log, "warn").mockImplementation(() => {}),
    spyOn(log, "error").mockImplementation(async () => {}),
  ];
  cleanups.push(() => {
    for (const mock of mocks) mock.mockRestore();
  });

  const provider = spyOn(featureExecutors, "callExpressionInitializationForProvider")
    .mockResolvedValue({ success: false, error: "Image input unavailable" })
    .mockResolvedValueOnce({
      success: true,
      data: {
        expressions: emojis.map((emoji) => ({
          name: emoji.emoji_name,
          emotion_key: "neutral",
          description: "A small round expression.",
        })),
      },
      skippedImages: [{ imageIndex: 0, imageCount: emojis.length, failureStage: "image-download", httpStatus: 404 }],
    });
  const write = spyOn(serverRepository, "initializeExpressions").mockImplementation(
    async (_serverId, results, scope) => {
      const written: string[] = [];
      for (const emoji of emojis) {
        if (!scope.emojiDiscIds.includes(emoji.emoji_disc_id)) continue;
        const result = results.find((entry) => entry.name === emoji.emoji_name);
        if (!result) continue;
        emoji.emoji_desc = result.description;
        emoji.emotion_key = result.emotion_key;
        written.push(emoji.emoji_disc_id);
      }
      return { emojiDiscIds: written, stickerDiscIds: [] };
    },
  );
  cleanups.push(
    () => provider.mockRestore(),
    () => write.mockRestore(),
  );

  const { interaction } = makeFakeInteraction({
    guild: { id: "fixture-guild", name: "Fixture" },
    memberPermissions: { has: () => true },
  });
  await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");

  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][2]).toMatchObject({ emojiDiscIds: [emojis[1].emoji_disc_id], stickerDiscIds: [] });
  expect(emojis[0].emotion_key).toBe("unset");
  expect(emojis[0].emoji_desc).toBeEmpty();
  expect(emojis[1].emotion_key).toBe("neutral");
  expect(emojis[1].emoji_desc).not.toBeEmpty();
  expect(provider.mock.calls.length).toBeGreaterThan(1);
});
