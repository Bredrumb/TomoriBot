import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("transcripts")
    .setDescription(localizer("en-US", "commands.speech.transcripts.description"))
    .addStringOption((option) =>
      option
        .setName("set")
        .setDescription(localizer("en-US", "commands.speech.transcripts.set_description"))
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
    });
    return;
  }

  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const setAction = interaction.options.getString("set", true);
    const isEnabled = setAction === "enable";

    const tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const currentSetting = tomoriState.config.voice_transcript_chat_mode ?? true;
    if (currentSetting === isEnabled) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.speech.transcripts.already_set_title",
        descriptionKey: isEnabled
          ? "commands.speech.transcripts.already_enabled_description"
          : "commands.speech.transcripts.already_disabled_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const updated = await configRepository.updateSpeechConfig(tomoriState.server_id, {
      voice_transcript_chat_mode: isEnabled,
    });

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "speech transcripts",
          voiceTranscriptChatMode: isEnabled,
          targetTable: "server_speech_configs",
        },
      };
      await log.error(
        "Failed to update voice_transcript_chat_mode config",
        new Error("Database update returned no rows"),
        context,
      );
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(serverDiscId);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.speech.transcripts.success_title",
      descriptionKey: isEnabled
        ? "commands.speech.transcripts.enabled_success"
        : "commands.speech.transcripts.disabled_success",
      color: isEnabled ? ColorCode.SUCCESS : ColorCode.WARN,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(serverDiscId))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "speech transcripts",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /speech transcripts command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
