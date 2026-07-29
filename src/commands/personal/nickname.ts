import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow, ErrorContext, TomoriState } from "../../types/db/schema";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import { getCachedTomoriState } from "../../utils/cache/tomoriStateCache";
import { invalidateUserCache } from "../../utils/cache/userCache";
import { userRepository } from "@/utils/db/repositories";

const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 32;

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("nickname") // Keep name simple as per refactor
    .setDescription(localizer("en-US", "commands.personal.nickname.description"))
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription(localizer("en-US", "commands.personal.nickname.option_description"))
        .setRequired(true)
        .setMinLength(NICKNAME_MIN_LENGTH)
        .setMaxLength(NICKNAME_MAX_LENGTH),
    );

/**
 * JSDoc comment for exported function
 * Updates how Tomori refers to the user.
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let tomoriState: TomoriState | null = null; // Define outside for catch block

  try {
    const newNickname = interaction.options.getString("name", true);

    // Validate nickname length (redundant check, Discord handles this, but good for safety)
    // Let helper functions manage interaction state
    if (newNickname.length < NICKNAME_MIN_LENGTH || newNickname.length > NICKNAME_MAX_LENGTH) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.nickname.invalid_length_title",
        descriptionKey: "commands.personal.nickname.invalid_length",
        descriptionVars: {
          min: NICKNAME_MIN_LENGTH.toString(),
          max: NICKNAME_MAX_LENGTH.toString(),
        },
        color: ColorCode.ERROR,
        // No flags needed, already deferred
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

    const oldNickname = userData.user_nickname;

    // biome-ignore lint/style/noNonNullAssertion: userData.user_id is always provided by command framework
    const ok = await userRepository.setNickname(userData.user_id!, newNickname);

    if (!ok) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Invalidate user cache so next message gets fresh data
    invalidateUserCache(interaction.user.id);

    let descriptionKey = "commands.personal.nickname.success_description";
    let embedColor = ColorCode.SUCCESS;

    // Assuming 'personalization_enabled' is the single config key
    // biome-ignore lint/style/noNonNullAssertion: tomoriState checked earlier
    if (!tomoriState!.config.personal_memories_enabled) {
      descriptionKey = "commands.personal.nickname.success_but_disabled_description"; // Use the warning description
      embedColor = ColorCode.WARN; // Use warning color
    }

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.personal.nickname.success_title",
      descriptionKey: descriptionKey, // Use the determined description key
      descriptionVars: {
        old_nickname: oldNickname,
        new_nickname: newNickname,
      },
      color: embedColor, // Use the determined color
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id, // Use optional chaining
      personaId: tomoriState?.persona_id, // Use optional chaining
      errorType: "CommandExecutionError",
      metadata: {
        command: "teach nickname",
        userDiscordId: interaction.user.id,
        guildId: interaction.guild?.id,
      },
    };
    await log.error("Error in /teach nickname command", error, context);

    // Use helper for unknown error embed
    // Use followUp since we deferred initially
    if (interaction.deferred || interaction.replied) {
      try {
        await interaction.followUp({
          content: localizer(locale, "general.errors.unknown_error_description"),
          flags: MessageFlags.Ephemeral,
        });
      } catch (followUpError) {
        log.error("Failed to send follow-up error message in nickname catch block", followUpError);
      }
    } else {
      // This case should be rare after initial deferReply
      log.warn("Interaction was not replied or deferred in nickname catch block, cannot send error message.", context);
    }
  }
}
