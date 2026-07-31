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
import { deleteOptApiKey, hasOptApiKey } from "@/utils/security/crypto";

/**
 * Configure the subcommand for removing Brave Search API key
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.optional-key.brave.remove.description"));

/**
 * Removes the Brave Search API key from the server's MCP configuration
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  let tomoriState: TomoriState | null = null; // For error context

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

  try {
    tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Check if there's a Brave Search API key to remove
    const hasKey = await hasOptApiKey(tomoriState.server_id, "brave-search");
    if (!hasKey) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.optional-key.brave.remove.no_key_title",
        descriptionKey: "commands.optional-key.brave.remove.no_key_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Delete the API key from the optional API keys table
    const isDeleted = await deleteOptApiKey(tomoriState.server_id, "brave-search");

    if (!isDeleted) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "optional-key brave remove",
          guildId: interaction.guild?.id ?? interaction.user.id,
          serviceName: "brave-search",
        },
      };
      await log.error(
        "Failed to delete Brave Search API key from optional API keys table",
        new Error("deleteOptApiKey returned false"),
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
      titleKey: "commands.optional-key.brave.remove.success_title",
      descriptionKey: "commands.optional-key.brave.remove.success_description",
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
        command: "optional-key brave remove",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
        serviceName: "brave-search",
      },
    };
    await log.error(
      `Error executing /optional-key brave remove for user ${userData.user_disc_id}`,
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
