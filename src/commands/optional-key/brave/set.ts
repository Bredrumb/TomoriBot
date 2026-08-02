import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow, ErrorContext, TomoriState } from "@/types/db/schema";
import { storeOptApiKey } from "@/utils/security/crypto";
import { braveWebSearch } from "../../../tools/restAPIs/brave/braveSearchService";

/**
 * Configure the subcommand for setting Brave Search API key
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("set")
    .setDescription(localizer("en-US", "commands.optional-key.brave.set.description"))
    .addStringOption((option) =>
      option
        .setName("key")
        .setDescription(localizer("en-US", "commands.optional-key.brave.set.key_description"))
        .setRequired(true),
    );

/**
 * Sets the Brave Search API key for the server's MCP configuration
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let apiKey: string | null = null; // For error context
  let tomoriState: TomoriState | null = null; // For error context

  try {
    apiKey = interaction.options.getString("key", true);

    if (!apiKey || apiKey.length < 10) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.optional-key.brave.set.invalid_key_title",
        descriptionKey: "commands.optional-key.brave.set.invalid_key_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    try {
      const validationResult = await Promise.race([
        braveWebSearch({ q: "test" }, { apiKey: apiKey, timeout: 5000 }),
        new Promise<{ success: boolean }>((resolve) => setTimeout(() => resolve({ success: false }), 5000)),
      ]);

      if (!validationResult.success) {
        // Don't log specific validation failures - they could contain sensitive info
        log.info(`Brave API key validation failed for server ${tomoriState.server_id}`);
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.optional-key.brave.set.key_validation_failed_title",
          descriptionKey: "commands.optional-key.brave.set.key_validation_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }
    } catch (_error) {
      // Same error handling regardless of error type to prevent information leakage
      log.info(`Brave API key validation error for server ${tomoriState.server_id}`);
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.optional-key.brave.set.key_validation_failed_title",
        descriptionKey: "commands.optional-key.brave.set.key_validation_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Store the validated API key
    const isStored = await storeOptApiKey(tomoriState.server_id, "brave-search", apiKey);

    if (!isStored) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "optional-key brave set",
          guildId: interaction.guild?.id ?? interaction.user.id,
          serviceName: "brave-search",
        },
      };
      await log.error(
        "Failed to store Brave Search API key in optional API keys table",
        new Error("storeOptApiKey returned false"),
        context,
      );

      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.optional-key.brave.set.success_title",
      descriptionKey: "commands.optional-key.brave.set.success_description",
      color: ColorCode.SUCCESS,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id ?? null,
      personaId: tomoriState?.persona_id ?? null,
      errorType: "CommandExecutionError",
      metadata: {
        command: "optional-key brave set",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
        serviceName: "brave-search",
        // Do not log API key or any hints about its structure
      },
    };
    await log.error(
      `Error executing /optional-key brave set for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
