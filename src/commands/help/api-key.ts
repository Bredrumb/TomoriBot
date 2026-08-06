import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import type { ErrorContext } from "@/types/db/schema";
import type { SummaryEmbedOptions } from "@/types/discord/embed";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/ui/embeds";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { DOCS_PATHS } from "@/utils/discord/docsLinks";

/**
 * Configure the /help api-key subcommand
 * Provider-specific instructions for getting and setting up API keys
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("api-key")
    .setDescription(localizer("en-US", "commands.help.api-key.description"))
    .addStringOption((option) =>
      option
        .setName("provider")
        .setDescription(localizer("en-US", "commands.help.api-key.provider_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.help.api-key.provider_choice_brave"),
            value: "brave",
          },
          {
            name: localizer("en-US", "commands.help.api-key.provider_choice_google"),
            value: "google",
          },
          {
            name: localizer("en-US", "commands.help.api-key.provider_choice_deepseek"),
            value: "deepseek",
          },
          {
            name: localizer("en-US", "commands.help.api-key.provider_choice_custom"),
            value: "custom",
          },
          {
            name: localizer("en-US", "commands.help.api-key.provider_choice_nvidia"),
            value: "nvidia",
          },
          {
            name: localizer("en-US", "commands.help.api-key.provider_choice_novelai"),
            value: "novelai",
          },
          {
            name: localizer("en-US", "commands.help.api-key.provider_choice_openrouter"),
            value: "openrouter",
          },
          {
            name: localizer("en-US", "commands.help.api-key.provider_choice_zai"),
            value: "zai",
          },
          {
            name: localizer("en-US", "commands.help.api-key.provider_choice_vertex"),
            value: "vertex",
          },
          {
            name: localizer("en-US", "commands.help.api-key.provider_choice_vertexexpress"),
            value: "vertexexpress",
          },
          {
            name: localizer("en-US", "commands.help.api-key.provider_choice_elevenlabs"),
            value: "elevenlabs",
          },
        ),
    );

/**
 * Execute the /help api-key command
 * Displays provider-specific API key setup instructions
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const provider = interaction.options.getString("provider", true);

    const configBraveapiSetMention = commandRegistry.getCommandMention("optional-key", "brave", "set");
    const configSetupMention = commandRegistry.getCommandMention("config", "setup");
    const configApikeySetMention = commandRegistry.getCommandMention("provider", "add");
    const configModelMention = commandRegistry.getCommandMention("model", "text");
    const configModelEmbeddingMention = commandRegistry.getCommandMention("model", "embedding");
    const configModelImageMention = commandRegistry.getCommandMention("model", "image");
    const configCustomModelsAddMention = commandRegistry.getCommandMention("provider", "custom-endpoint", "add");
    const personalCustomModelsAddMention = commandRegistry.getCommandMention("personal", "custom-endpoint", "add");
    const helpCustomModelsMention = commandRegistry.getCommandMention("help", "custom-endpoint");
    const supportServerMention = commandRegistry.getCommandMention("support", "discord");
    const configSpeechElevenlabsMention = commandRegistry.getCommandMention("speech", "elevenlabs");
    const configSpeechVoiceAssignMention = commandRegistry.getCommandMention("speech", "voice-assign");
    const configSpeechTranscriptsMention = commandRegistry.getCommandMention("speech", "transcripts");

    // AC-2 allowlist rationale: /help api-key is provider-specific UI copy,
    // not orchestration. Each case selects localized instructions for where a
    // user gets that provider's key and which config commands apply.
    let embedOptions: SummaryEmbedOptions;

    switch (provider) {
      case "brave":
        embedOptions = {
          titleKey: "commands.help.api-key.brave_title",
          descriptionKey: "commands.help.api-key.brave_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.api-key.brave_getting_key_title",
              value: localizer(locale, "commands.help.api-key.brave_getting_key_description", {
                configBraveapiSet: configBraveapiSetMention,
              }),
              inline: false,
            },
            {
              nameKey: "commands.help.api-key.brave_important_title",
              value: localizer(locale, "commands.help.api-key.brave_important_description"),
              inline: false,
            },
          ],
          footerKey: "commands.help.api-key.brave_footer",
        };
        break;

      // Provider-specific help pages are user-facing copy, not runtime provider dispatch.
      // Phase 3 #6.5 allows these display switches to remain outside core orchestration.
      case "google":
        embedOptions = {
          titleKey: "commands.help.api-key.google_title",
          descriptionKey: "commands.help.api-key.google_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.api-key.google_getting_key_title",
              value: localizer(locale, "commands.help.api-key.google_getting_key_description", {
                configSetup: configSetupMention,
                configApikeySet: configApikeySetMention,
              }),
              inline: false,
            },
          ],
          footerKey: "commands.help.api-key.google_footer",
          footerVars: {
            configModel: configModelMention,
          },
        };
        break;

      case "deepseek":
        embedOptions = {
          titleKey: "commands.help.api-key.deepseek_title",
          descriptionKey: "commands.help.api-key.deepseek_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.api-key.deepseek_getting_key_title",
              value: localizer(locale, "commands.help.api-key.deepseek_getting_key_description", {
                configSetup: configSetupMention,
                configApikeySet: configApikeySetMention,
              }),
              inline: false,
            },
          ],
          footerKey: "commands.help.api-key.deepseek_footer",
          footerVars: {
            configModel: configModelMention,
          },
        };
        break;

      case "custom":
        embedOptions = {
          titleKey: "commands.help.api-key.custom_title",
          descriptionKey: "commands.help.api-key.custom_description",
          descriptionVars: {
            configSetup: configSetupMention,
            configCustomModelsAdd: configCustomModelsAddMention,
            personalCustomModelsAdd: personalCustomModelsAddMention,
            configModel: configModelMention,
            helpCustomModels: helpCustomModelsMention,
          },
          color: ColorCode.INFO,
          fields: [],
        };
        break;

      case "nvidia":
        embedOptions = {
          titleKey: "commands.help.api-key.nvidia_title",
          descriptionKey: "commands.help.api-key.nvidia_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.api-key.nvidia_getting_key_title",
              value: localizer(locale, "commands.help.api-key.nvidia_getting_key_description", {
                configSetup: configSetupMention,
                configApikeySet: configApikeySetMention,
              }),
              inline: false,
            },
            {
              nameKey: "commands.help.api-key.nvidia_important_title",
              value: localizer(locale, "commands.help.api-key.nvidia_important_description"),
              inline: false,
            },
          ],
          footerKey: "commands.help.api-key.nvidia_footer",
          footerVars: {
            configModel: configModelMention,
            configModelEmbedding: configModelEmbeddingMention,
            configModelImage: configModelImageMention,
          },
        };
        break;

      case "novelai":
        embedOptions = {
          titleKey: "commands.help.api-key.novelai_title",
          descriptionKey: "commands.help.api-key.novelai_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.api-key.novelai_getting_key_title",
              value: localizer(locale, "commands.help.api-key.novelai_getting_key_description", {
                configSetup: configSetupMention,
                configApikeySet: configApikeySetMention,
              }),
              inline: false,
            },
          ],
          footerKey: "commands.help.api-key.novelai_footer",
          footerVars: {
            configModel: configModelMention,
          },
        };
        break;

      case "openrouter":
        embedOptions = {
          titleKey: "commands.help.api-key.openrouter_title",
          descriptionKey: "commands.help.api-key.openrouter_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.api-key.openrouter_getting_key_title",
              value: localizer(locale, "commands.help.api-key.openrouter_getting_key_description", {
                configSetup: configSetupMention,
                configApikeySet: configApikeySetMention,
              }),
              inline: false,
            },
            {
              nameKey: "commands.help.api-key.openrouter_important_title",
              value: localizer(locale, "commands.help.api-key.openrouter_important_description", {
                supportServer: supportServerMention,
              }),
              inline: false,
            },
          ],
          footerKey: "commands.help.api-key.openrouter_footer",
          footerVars: {
            configModel: configModelMention,
          },
        };
        break;

      case "zai":
        embedOptions = {
          titleKey: "commands.help.api-key.zai_title",
          descriptionKey: "commands.help.api-key.zai_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.api-key.zai_getting_key_title",
              value: localizer(locale, "commands.help.api-key.zai_getting_key_description", {
                configSetup: configSetupMention,
                configApikeySet: configApikeySetMention,
              }),
              inline: false,
            },
            {
              nameKey: "commands.help.api-key.zai_important_title",
              value: localizer(locale, "commands.help.api-key.zai_important_description"),
              inline: false,
            },
          ],
          footerKey: "commands.help.api-key.zai_footer",
          footerVars: {
            configModel: configModelMention,
          },
        };
        break;

      case "vertex":
        embedOptions = {
          titleKey: "commands.help.api-key.vertex_title",
          descriptionKey: "commands.help.api-key.vertex_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.api-key.vertex_getting_key_title",
              value: localizer(locale, "commands.help.api-key.vertex_getting_key_description", {
                configSetup: configSetupMention,
                configApikeySet: configApikeySetMention,
              }),
              inline: false,
            },
            {
              nameKey: "commands.help.api-key.vertex_important_title",
              value: localizer(locale, "commands.help.api-key.vertex_important_description"),
              inline: false,
            },
          ],
          footerKey: "commands.help.api-key.vertex_footer",
          footerVars: {
            configModel: configModelMention,
          },
        };
        break;

      case "vertexexpress":
        embedOptions = {
          titleKey: "commands.help.api-key.vertexexpress_title",
          descriptionKey: "commands.help.api-key.vertexexpress_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.api-key.vertexexpress_getting_key_title",
              value: localizer(locale, "commands.help.api-key.vertexexpress_getting_key_description", {
                configSetup: configSetupMention,
                configApikeySet: configApikeySetMention,
                configModel: configModelMention,
              }),
              inline: false,
            },
            {
              nameKey: "commands.help.api-key.vertexexpress_important_title",
              value: localizer(locale, "commands.help.api-key.vertexexpress_important_description"),
              inline: false,
            },
          ],
          footerKey: "commands.help.api-key.vertexexpress_footer",
          footerVars: {
            configModel: configModelMention,
          },
        };
        break;

      case "elevenlabs":
        embedOptions = {
          titleKey: "commands.help.elevenlabs.title",
          descriptionKey: "commands.help.elevenlabs.description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.elevenlabs.getting_key_title",
              value: localizer(locale, "commands.help.elevenlabs.getting_key_description", {
                configSpeechElevenlabs: configSpeechElevenlabsMention,
              }),
              inline: false,
            },
            {
              nameKey: "commands.help.elevenlabs.free_voices_title",
              value: localizer(locale, "commands.help.elevenlabs.free_voices_description", {
                configSpeechElevenlabs: configSpeechElevenlabsMention,
              }),
              inline: false,
            },
            {
              nameKey: "commands.help.elevenlabs.choosing_voice_title",
              value: localizer(locale, "commands.help.elevenlabs.choosing_voice_description", {
                configSpeechVoiceAssign: configSpeechVoiceAssignMention,
              }),
              inline: false,
            },
            {
              nameKey: "commands.help.elevenlabs.important_notes_title",
              value: localizer(locale, "commands.help.elevenlabs.important_notes_description", {
                configSpeechTranscripts: configSpeechTranscriptsMention,
              }),
              inline: false,
            },
          ],
          footerKey: "commands.help.elevenlabs.footer",
          footerVars: {
            configSpeechElevenlabs: configSpeechElevenlabsMention,
          },
        };
        break;

      default:
        // Should never happen due to choices validation
        throw new Error(`Unknown provider: ${provider}`);
    }

    embedOptions.docsPath =
      provider === "custom"
        ? DOCS_PATHS.CUSTOM_ENDPOINTS
        : provider === "elevenlabs"
          ? DOCS_PATHS.TTS
          : DOCS_PATHS.API_KEYS;

    await replySummaryEmbed(interaction, locale, embedOptions, MessageFlags.Ephemeral);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help api-key",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help api-key command", error as Error, context);

    const errorMessage = localizer(locale, "general.errors.unknown_error_description");
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      log.error("Failed to send error reply for /help api-key", replyError, context);
    }
  }
}
