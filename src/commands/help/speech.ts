import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import type { SummaryEmbedOptions } from "@/types/discord/embed";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { replySummaryEmbed } from "@/utils/discord/interactionHelper";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

type SpeechHelpEngine = "overview" | "chatterbox" | "qwen3tts" | "irodoritts" | "elevenlabs";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("speech")
    .setDescription(localizer("en-US", "commands.help.speech.description"))
    .addStringOption((option) =>
      option
        .setName("engine")
        .setDescription(localizer("en-US", "commands.help.speech.engine_description"))
        .setRequired(false)
        .addChoices(
          { name: "Overview", value: "overview" },
          { name: "Chatterbox-Turbo", value: "chatterbox" },
          { name: "Qwen3-TTS", value: "qwen3tts" },
          { name: "IrodoriTTS", value: "irodoritts" },
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
    const engine = (interaction.options.getString("engine") ?? "overview") as SpeechHelpEngine;
    const customEndpointAdd = commandRegistry.getCommandMention("provider", "custom-endpoint", "add");
    const modelSpeech = commandRegistry.getCommandMention("model", "speech");
    const voiceAdd = commandRegistry.getCommandMention("speech", "voice-add");
    const voiceAssign = commandRegistry.getCommandMention("speech", "voice-assign");
    const voiceDesignSet = commandRegistry.getCommandMention("speech", "voice-design", "set");
    const elevenlabs = commandRegistry.getCommandMention("speech", "elevenlabs");
    const helpTranscription = commandRegistry.getCommandMention("help", "transcription");

    const embedOptions: SummaryEmbedOptions = {
      titleKey: `commands.help.speech.${engine}.title`,
      descriptionKey: `commands.help.speech.${engine}.description`,
      descriptionVars: {
        custom_endpoint_add: customEndpointAdd,
        model_speech: modelSpeech,
        voice_add: voiceAdd,
        voice_assign: voiceAssign,
        voice_design_set: voiceDesignSet,
        elevenlabs,
        help_transcription: helpTranscription,
      },
      color: ColorCode.INFO,
      fields: [
        {
          nameKey: `commands.help.speech.${engine}.steps_title`,
          value: localizer(locale, `commands.help.speech.${engine}.steps_description`, {
            custom_endpoint_add: customEndpointAdd,
            model_speech: modelSpeech,
            voice_add: voiceAdd,
            voice_assign: voiceAssign,
            voice_design_set: voiceDesignSet,
            elevenlabs,
          }),
          inline: false,
        },
        {
          nameKey: "commands.help.speech.docs_title",
          value: localizer(locale, "commands.help.speech.docs_description"),
          inline: false,
        },
      ],
    };

    await replySummaryEmbed(interaction, locale, embedOptions, MessageFlags.Ephemeral);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { commandName: "/help speech", guildDiscordId: interaction.guild?.id },
    };
    await log.error("Error executing /help speech command", error as Error, context);
    await interaction.reply({
      content: localizer(locale, "general.errors.unknown_error_description"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
