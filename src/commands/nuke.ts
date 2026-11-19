import { type ChatInputCommandInteraction, type Client, MessageFlags, type SlashCommandBuilder } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { serverRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

export const guildOnly = true;
export const managerOnly = true;

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("nuke")
    .setDescription(localizer("en-US", "commands.nuke.description"))
    .addStringOption((option) =>
      option
        .setName("confirmation")
        .setDescription(localizer("en-US", "commands.nuke.confirmation_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.nuke.confirmation_choice_yes"),
            value: "yes",
          },
          {
            name: localizer("en-US", "commands.nuke.confirmation_choice_no"),
            value: "no",
          },
        ),
    )
    .addBooleanOption((option) =>
      option
        .setName("preserve_personas")
        .setDescription(localizer("en-US", "commands.nuke.preserve_personas_description"))
        .setRequired(false),
    );

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const guildDiscId = interaction.guild?.id;

  try {
    // Fails closed without a guild rather than falling back to user id, so removing guildOnly cannot allow an
    // unchecked DM wipe of the user's own workspace.
    const hasPermission = Boolean(guildDiscId) && (interaction.memberPermissions?.has("ManageGuild") ?? false);
    if (!guildDiscId || !hasPermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.delete.no_permission_title",
        descriptionKey: "commands.data.delete.no_permission_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const confirmation = interaction.options.getString("confirmation", true);
    if (confirmation !== "yes") {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.nuke.cancelled_title",
        descriptionKey: "commands.nuke.cancelled_description",
        color: ColorCode.INFO,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const preservePersonas = interaction.options.getBoolean("preserve_personas") ?? false;

    const serverId = await serverRepository.loadServerIdByDiscId(guildDiscId);
    if (!serverId) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.delete.no_server_data_title",
        descriptionKey: "commands.data.delete.no_server_data_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Best-effort webhook cleanup runs before nukeServer because deleting DB rows destroys the decrypted tokens.
    let webhooksDeleted = 0;
    let webhooksFailed = 0;
    const managedWebhooks = await serverRepository.listManagedWebhooksDecrypted(guildDiscId);
    for (const { webhookDiscId, token } of managedWebhooks) {
      try {
        const webhook = await client.fetchWebhook(webhookDiscId, token);
        await webhook.delete("TomoriBot /nuke");
        webhooksDeleted++;
      } catch (error) {
        webhooksFailed++;
        log.warn(`[Nuke] Failed to delete Discord webhook ${webhookDiscId} for guild ${guildDiscId}`, error);
      }
    }

    const nuked = await serverRepository.nukeServer(serverId, guildDiscId, {
      preservePersonas,
    });

    if (!nuked) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.delete.no_server_data_title",
        descriptionKey: "commands.data.delete.no_server_data_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    invalidateTomoriStateCache(guildDiscId);

    await replyInfoEmbed(interaction, locale, {
      titleKey: preservePersonas ? "commands.nuke.success_preserved_title" : "commands.nuke.success_full_title",
      descriptionKey: preservePersonas
        ? "commands.nuke.success_preserved_description"
        : "commands.nuke.success_full_description",
      descriptionVars: {
        webhooks_deleted: webhooksDeleted,
        webhooks_failed: webhooksFailed,
      },
      color: ColorCode.SUCCESS,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "nuke",
        guildDiscId,
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /nuke command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
