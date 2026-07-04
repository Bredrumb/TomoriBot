import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import type { SummaryEmbedOptions } from "@/types/discord/embed";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { DOCS_PATHS } from "@/utils/discord/docsLinks";
import { replySummaryEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

type TranscriptionHelpEngine = "overview" | "whisperx" | "koboldcpp" | "elevenlabs";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("transcription")
    .setDescription(localizer("en-US", "commands.help.transcription.description"))
    .addStringOption((option) =>
      option
        .setName("engine")
        .setDescription(localizer("en-US", "commands.help.transcription.engine_description"))
        .setRequired(false)
        .addChoices(
          { name: "Overview", value: "overview" },
          { name: "WhisperX", value: "whisperx" },
          { name: "KoboldCPP", value: "koboldcpp" },
          { name: "ElevenLabs", value: "elevenlabs" },
        ),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const engine = (interaction.options.getString("engine") ?? "overview") as TranscriptionHelpEngine;
    const customEndpointAdd = commandRegistry.getCommandMention("provider", "custom-endpoint", "add");
    const modelTranscription = commandRegistry.getCommandMention("model", "transcription");
    const elevenLabs = commandRegistry.getCommandMention("speech", "elevenlabs");
    const speechTranscripts = commandRegistry.getCommandMention("speech", "transcripts");
    const helpSpeech = commandRegistry.getCommandMention("help", "speech");

    const embedOptions: SummaryEmbedOptions = {
      titleKey: `commands.help.transcription.${engine}.title`,
      descriptionKey: `commands.help.transcription.${engine}.description`,
      descriptionVars: {
        custom_endpoint_add: customEndpointAdd,
        model_transcription: modelTranscription,
        elevenlabs: elevenLabs,
        speech_transcripts: speechTranscripts,
        help_speech: helpSpeech,
      },
      color: ColorCode.INFO,
      docsPath: DOCS_PATHS.STT,
      fields: [
        {
          nameKey: "commands.help.transcription.summary_title",
          value: localizer(locale, "commands.help.transcription.summary_description", {
            custom_endpoint_add: customEndpointAdd,
            model_transcription: modelTranscription,
            elevenlabs: elevenLabs,
            speech_transcripts: speechTranscripts,
          }),
          inline: false,
        },
      ],
    };

    await replySummaryEmbed(interaction, locale, embedOptions, MessageFlags.Ephemeral);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { commandName: "/help transcription", guildDiscordId: interaction.guild?.id },
    };
    await log.error("Error executing /help transcription command", error as Error, context);
    await interaction.reply({
      content: localizer(locale, "general.errors.unknown_error_description"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
