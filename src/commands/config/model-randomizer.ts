import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("model-randomizer")
    .setDescription(localizer("en-US", "commands.config.model-randomizer.description"))
    .addStringOption((option) =>
      option
        .setName("set")
        .setDescription(localizer("en-US", "commands.config.model-randomizer.set_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.config.options.enable"),
            value: "enable",
          },
          {
            name: localizer("en-US", "commands.config.options.disable"),
            value: "disable",
          },
        ),
    );

/**
 * Toggles the per-turn text model randomizer. When enabled, each generation turn randomly picks a
 * lead model from the pool of primary model + configured fallback models, breaking the bot out of a
 * single model's repetitive phrasing while keeping the remaining models as failover.
 *
 * Enabling is refused unless the server has at least one fallback model configured (`/model fallback`),
 * so the pool always has >=2 members and the toggle is never a silent no-op.
 *
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // Guard against DM/threadless contexts before deferring.
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const setAction = interaction.options.getString("set", true);
    const isEnabled = setAction === "enable";

    // Require an existing setup before toggling.
    const tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Block-until-fallbacks: enabling needs >=1 fallback so the pool has >=2 members.
    const hasFallbacks = (tomoriState.config.fallback_model_refs ?? []).length > 0;
    if (isEnabled && !hasFallbacks) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.model-randomizer.no_fallbacks_title",
        descriptionKey: "commands.config.model-randomizer.no_fallbacks_description",
        color: ColorCode.WARN,
      });
      return;
    }

    // Idempotency guard: no DB write when already in the requested state.
    const currentSetting = tomoriState.config.model_randomizer_enabled ?? false;
    if (currentSetting === isEnabled) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.model-randomizer.already_set_title",
        descriptionKey: isEnabled
          ? "commands.config.model-randomizer.already_enabled_description"
          : "commands.config.model-randomizer.already_disabled_description",
        color: ColorCode.WARN,
      });
      return;
    }

    // Persist the new flag through the generic chat-config writer.
    const updated = await configRepository.updateChatConfig(tomoriState.server_id, {
      model_randomizer_enabled: isEnabled,
    });

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config model-randomizer",
          modelRandomizerEnabled: isEnabled,
          targetTable: "server_chat_configs",
        },
      };
      await log.error("Failed to update model_randomizer_enabled config", new Error("Database update failed"), context);
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Invalidate the cached state BEFORE replying so the next turn reads the fresh flag.
    invalidateTomoriStateCache(serverDiscId);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.config.model-randomizer.success_title",
      descriptionKey: isEnabled
        ? "commands.config.model-randomizer.enabled_success"
        : "commands.config.model-randomizer.disabled_success",
      color: isEnabled ? ColorCode.SUCCESS : ColorCode.WARN,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(serverDiscId))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config model-randomizer",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /config model-randomizer command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
