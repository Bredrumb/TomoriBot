import { afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ApplicationCommandOptionChoiceData, AutocompleteInteraction, Client } from "discord.js";
import * as states from "@/utils/cache/tomoriStateCache";
import { userRepository } from "@/utils/db/repositories";
import { createGenerationModelAutocomplete } from "@/utils/discord/autocomplete/generationModelAutocomplete";
import * as models from "@/utils/provider/generationModels";
import type { GenerationModelCapability } from "@/types/provider/generationModels";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { localizedCopy } from "../../helpers/localeCases";

let choices: models.GenerationModelChoice[];
let catalogSpy: ReturnType<typeof spyOn<typeof models, "loadGenerationModelChoices">>;
let stateSpy: ReturnType<typeof spyOn<typeof states, "getCachedTomoriState">>;
let userSpy: ReturnType<typeof spyOn<typeof userRepository, "loadByDiscordId">>;

beforeAll(initializeLocalizer);
beforeEach(() => {
  choices = [];
  catalogSpy = spyOn(models, "loadGenerationModelChoices").mockImplementation(async () => choices);
  stateSpy = spyOn(states, "getCachedTomoriState").mockResolvedValue(createPersona({ server_id: 12 }));
  userSpy = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(createUserRow({ user_id: 34 }));
});
afterEach(() => {
  catalogSpy.mockRestore();
  stateSpy.mockRestore();
  userSpy.mockRestore();
});

async function suggestions(
  input: {
    search?: string;
    capability?: GenerationModelCapability;
    subcommand?: string;
    commandName?: string;
    mode?: string;
    upload?: boolean;
    design?: string;
  } = {},
) {
  let result: ApplicationCommandOptionChoiceData<string>[] = [];
  const { interaction } = makeFakeInteraction();
  Object.assign(interaction.options, {
    getFocused: () => input.search ?? "",
    getSubcommand: () => input.subcommand ?? "image",
    getString: (name: string) =>
      name === "mode" ? (input.mode ?? "manual") : name === "voice_design" ? (input.design ?? null) : null,
    get: () => (input.upload ? { attachment: "sample" } : null),
  });
  Object.assign(interaction, {
    locale: "en-US",
    commandName: input.commandName ?? "generate",
    isAutocomplete: () => true,
    respond: async (data: typeof result) => {
      result = data;
    },
  });
  await createGenerationModelAutocomplete(input.capability ?? "image")(
    {} as Client,
    interaction as unknown as AutocompleteInteraction,
  );
  return result;
}

describe("Generation model autocomplete", () => {
  it("searches the whole catalog before applying Discord's limit and uses the invoking user's scope", async () => {
    choices = Array.from({ length: 40 }, (_, modelId) => ({
      kind: "image",
      source: "server",
      provider: "google",
      modelId: modelId + 1,
      name: `model-${modelId.toString().padStart(2, "0")}`,
    }));
    expect(await suggestions()).toHaveLength(25);
    expect((await suggestions({ search: "model-39" })).map((entry) => entry.value)).toEqual([
      models.generationModelValue(choices[39]),
    ]);
    expect(catalogSpy).toHaveBeenCalledWith(12, 34, "image");
  });

  it("preserves separate personal labels within Discord's name limit and searches the full model name", async () => {
    const name = `${"long-model-".repeat(12)}searchable-tail`;
    choices = ["server", "personal"].map((source) => ({
      kind: "image",
      source: source as "server" | "personal",
      provider: "google",
      modelId: 1,
      name,
    }));
    const result = await suggestions({ search: "searchable-tail" });
    expect(new Set(result.map((entry) => entry.value)).size).toBe(2);
    expect(result.every((entry) => entry.name.length <= 100)).toBe(true);
    const personal = result.find((entry) => entry.value === models.generationModelValue(choices[1]));
    expect(
      personal?.name.endsWith(
        localizedCopy("en-US", "commands.generate.model_personal_suffix", {
          provider: getProviderDisplayName("google"),
        }),
      ),
    ).toBe(true);
  });

  it("offers NovelAI only in Auto image mode and filters speech models by supplied voice inputs", async () => {
    choices = [{ kind: "image-nai", source: "personal", provider: "novelai", modelId: 2, name: "nai-model" }];
    expect(await suggestions()).toEqual([]);
    expect(await suggestions({ mode: "auto" })).toHaveLength(1);
    expect(await suggestions({ commandName: "novelai", capability: "image-nai" })).toHaveLength(1);
    choices = ["design", "clone"].map((mode, index) => ({
      kind: "speech",
      source: "server",
      provider: "google",
      modelId: index + 1,
      name: `speech-${mode}`,
      speechModes: [mode as "design" | "clone"],
    }));
    const clone = await suggestions({ capability: "speech", subcommand: "voice-message", upload: true });
    expect(clone.map((entry) => entry.value)).toEqual([models.generationModelValue(choices[1])]);
    const design = await suggestions({ capability: "speech", subcommand: "voice-message", design: "Warm narrator" });
    expect(design.map((entry) => entry.value)).toEqual([models.generationModelValue(choices[0])]);
  });

  it("answers within the autocomplete window when the catalog does not respond", async () => {
    catalogSpy.mockImplementation(() => new Promise(() => undefined));
    expect(await suggestions()).toEqual([]);
  });
});
