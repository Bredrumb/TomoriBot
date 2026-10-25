import {
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { GenerationModelCapability } from "@/types/provider/generationModels";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { userRepository } from "@/utils/db/repositories";
import { replyInfoEmbed, safeSelectOptionText } from "@/utils/discord/ui/interactionCore";
import { ColorCode } from "@/utils/misc/logger";
import {
  generationModelValue,
  GENERATION_MODEL_CHOICE_MAX_LENGTH,
  loadGenerationModelChoices,
  type GenerationModelChoice,
} from "@/utils/provider/generationModels";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { localizer } from "@/utils/text/localizer";

// Discord rejects longer autocomplete lists, so the limit applies after searching the full catalog.
const MAX_AUTOCOMPLETE_CHOICES = 25;
const AUTOCOMPLETE_TIMEOUT_MS = 2_000;

export function addGenerationModelOption(
  subcommand: SlashCommandSubcommandBuilder,
  descriptionKey: string,
): SlashCommandSubcommandBuilder {
  return subcommand.addStringOption((option) =>
    option.setName("model").setDescription(localizer("en-US", descriptionKey)).setRequired(false).setAutocomplete(true),
  );
}

function compatibleChoices(
  choices: GenerationModelChoice[],
  interaction: AutocompleteInteraction | ChatInputCommandInteraction,
): GenerationModelChoice[] {
  if (
    interaction.commandName !== "novelai" &&
    interaction.options.getSubcommand() === "image" &&
    interaction.options.getString("mode") !== "auto"
  ) {
    return choices.filter((choice) => choice.kind !== "image-nai");
  }
  if (interaction.options.getSubcommand() === "voice-message") {
    const clone = interaction.isAutocomplete()
      ? Boolean(interaction.options.get("voice_sample"))
      : Boolean(interaction.options.getAttachment("voice_sample"));
    const design = Boolean(interaction.options.getString("voice_design")?.trim());
    return choices.filter(
      (choice) =>
        (!clone || choice.speechModes?.includes("clone")) && (!design || choice.speechModes?.includes("design")),
    );
  }
  return choices;
}

export function createGenerationModelAutocomplete(capability: GenerationModelCapability) {
  return async (_client: Client, interaction: AutocompleteInteraction): Promise<void> => {
    let responded = false;
    try {
      const buildChoices = async () => {
        const [state, user] = await Promise.all([
          getCachedTomoriState(interaction.guildId ?? interaction.user.id),
          userRepository.loadByDiscordId(interaction.user.id),
        ]);
        const choices = state
          ? compatibleChoices(
              await loadGenerationModelChoices(state.server_id, user?.user_id ?? null, capability),
              interaction,
            )
          : [];
        const focused = interaction.options.getFocused().toLowerCase().trim();
        const results = choices
          .map((choice) => {
            const provider = getProviderDisplayName(choice.provider, interaction.locale);
            const suffixKey =
              choice.source === "personal"
                ? "commands.generate.model_personal_suffix"
                : "commands.generate.model_server_suffix";
            const emptySuffix = localizer(interaction.locale, suffixKey, { provider: "" });
            const providerLabel = safeSelectOptionText(
              provider,
              GENERATION_MODEL_CHOICE_MAX_LENGTH - emptySuffix.length - 1,
            );
            const suffix = localizer(interaction.locale, suffixKey, { provider: providerLabel });
            const name = `${safeSelectOptionText(choice.name, GENERATION_MODEL_CHOICE_MAX_LENGTH - suffix.length)}${suffix}`;
            const model = choice.name.toLowerCase();
            const rank = model === focused ? 0 : model.startsWith(focused) ? 1 : 2;
            return {
              name,
              value: generationModelValue(choice),
              rank,
              search: `${choice.name} ${provider} ${suffix}`.toLowerCase(),
            };
          })
          .filter((choice) => choice.search.includes(focused))
          .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name))
          .slice(0, MAX_AUTOCOMPLETE_CHOICES)
          .map(({ name, value }) => ({ name, value }));
        return results;
      };
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const results = await Promise.race([
          buildChoices(),
          new Promise<Awaited<ReturnType<typeof buildChoices>>>((resolve) => {
            timeout = setTimeout(() => resolve([]), AUTOCOMPLETE_TIMEOUT_MS);
          }),
        ]);
        responded = true;
        await interaction.respond(results);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (!responded) {
        await interaction.respond([]).catch(() => undefined);
        throw error;
      }
    }
  };
}

export async function replyGenerationModelUnavailable(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  locale: string,
): Promise<void> {
  await replyInfoEmbed(interaction, locale, {
    titleKey: "commands.generate.model_unavailable_title",
    descriptionKey: "commands.generate.model_unavailable_description",
    color: ColorCode.WARN,
    flags: MessageFlags.Ephemeral,
  });
}

export async function resolveGenerationModelOption(
  interaction: ChatInputCommandInteraction,
  serverId: number,
  userId: number | null,
  locale: string,
  capability: GenerationModelCapability,
): Promise<GenerationModelChoice | null | false> {
  const value = interaction.options.getString("model");
  if (value === null) return null;
  const choices = compatibleChoices(await loadGenerationModelChoices(serverId, userId, capability), interaction);
  const choice = choices.find((entry) => generationModelValue(entry) === value);
  if (!choice) {
    await replyGenerationModelUnavailable(interaction, locale);
    return false;
  }
  return choice;
}
