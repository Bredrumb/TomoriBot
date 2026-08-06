import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { userRepository } from "@/utils/db/repositories";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import { getPluralKitProxyWaitMs } from "@/utils/chat/pluralkit/proxyExpectation";

/**
 * Formats the configured proxy-wait delay as a short seconds string for the
 * command reply (e.g. `2000` -> `"2"`, `1500` -> `"1.5"`), so the reply stays
 * accurate if an operator changes `PLURALKIT_PROXY_WAIT_MS`.
 */
function formatDelaySeconds(waitMs: number): string {
  return (waitMs / 1000).toFixed(1).replace(/\.0$/, "");
}

/**
 * Configures the `/personal pluralkit` subcommand.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("pluralkit")
    .setDescription(localizer("en-US", "commands.personal.pluralkit.description"))
    .addBooleanOption((option) =>
      option
        .setName("enabled")
        .setDescription(localizer("en-US", "commands.personal.pluralkit.enabled_description"))
        .setRequired(true),
    );

/**
 * Toggles PluralKit-aware message handling for the invoking user.
 * When enabled, TomoriBot waits briefly on the user's messages to see whether
 * PluralKit deletes and reposts them through a proxy webhook, and resolves
 * per-member identity (and a one-time bio-seeded memory) for that webhook.
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database (the command executor)
 * @param locale - Locale of the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = userData.user_id;
  if (userId === undefined) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  try {
    const requestedEnabled = interaction.options.getBoolean("enabled", true);
    const currentEnabled = userData.pluralkit_enabled ?? false;

    if (requestedEnabled === currentEnabled) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: currentEnabled
          ? "commands.personal.pluralkit.already_enabled_title"
          : "commands.personal.pluralkit.already_disabled_title",
        descriptionKey: currentEnabled
          ? "commands.personal.pluralkit.already_enabled_description"
          : "commands.personal.pluralkit.already_disabled_description",
        color: ColorCode.WARN,
      });
      return;
    }

    // setPluralKitEnabled routes through UserRepository.update, which invalidates
    // the user cache on success; no separate invalidation belongs here.
    const updated = await userRepository.setPluralKitEnabled(userId, requestedEnabled);
    if (!updated) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (requestedEnabled) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.pluralkit.enabled_success_title",
        descriptionKey: "commands.personal.pluralkit.enabled_success_description",
        descriptionVars: {
          delay_seconds: formatDelaySeconds(getPluralKitProxyWaitMs()),
        },
        color: ColorCode.SUCCESS,
      });
    } else {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.pluralkit.disabled_success_title",
        descriptionKey: "commands.personal.pluralkit.disabled_success_description",
        color: ColorCode.SUCCESS,
      });
    }

    log.info(`User ${interaction.user.id} (${userData.user_nickname}) set pluralkit_enabled to ${requestedEnabled}`);
  } catch (error) {
    const context: ErrorContext = {
      userId,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal pluralkit",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Error executing /personal pluralkit for user ${userData.user_disc_id}`, error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
