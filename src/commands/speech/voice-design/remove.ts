import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository } from "@/utils/db/repositories";

import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  PersonaWorkflowUpdateError,
  runPersonaPickerWorkflow,
} from "@/utils/discord/ui/personaWorkflow";
import { log, ColorCode } from "@/utils/misc/logger";
import { resolveActiveSpeechEndpoint } from "@/utils/provider/speechEndpointResolver";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.speech.voice-design.remove.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  let personaWorkflowStarted = false;

  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const speechEndpoint = await resolveActiveSpeechEndpoint(tomoriState.server_id);
    const supportsVoiceDesign =
      speechEndpoint?.endpoint.api_style === "tts-clone" &&
      speechEndpoint.endpoint.extra_config.supports_instruct === true;

    if (!supportsVoiceDesign) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.speech.voice_design.unsupported_endpoint_title",
        descriptionKey: "commands.speech.voice_design.unsupported_endpoint_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    personaWorkflowStarted = true;
    await runPersonaPickerWorkflow(interaction, locale, {
      personas: allPersonas,
      color: ColorCode.INFO,
      titleKey: "commands.speech.voice_design.select_persona_title",
      onSelected: async (selection) => {
        const { message } = await selection.beginInPlaceWork();
        const selectedPersona = selection.persona;

        try {
          if (!selectedPersona.persona_id) {
            await message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "general.errors.invalid_option_title",
                descriptionKey: "general.errors.invalid_option_description",
                color: ColorCode.ERROR,
              }),
            );
            return completePersonaWorkflow();
          }

          const voiceNameIfOtherVoiceRemains = selectedPersona.speech_voice_sample_id
            ? selectedPersona.speech_voice_name === "VoiceDesign"
              ? "Voice Clone"
              : (selectedPersona.speech_voice_name ?? null)
            : selectedPersona.speech_voice_id?.trim()
              ? (selectedPersona.speech_voice_name ?? null)
              : null;

          const updatedTomori = await personaRepository.setVoiceConfig(selectedPersona.persona_id, {
            speech_voice_sample_id: selectedPersona.speech_voice_sample_id ?? null,
            speech_voice_id: selectedPersona.speech_voice_id ?? null,
            speech_voice_design_prompt: null,
            speech_voice_name: voiceNameIfOtherVoiceRemains,
          });

          if (!updatedTomori) {
            await message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "general.errors.update_failed_title",
                descriptionKey: "general.errors.update_failed_description",
                color: ColorCode.ERROR,
              }),
            );
            return completePersonaWorkflow();
          }

          invalidateTomoriStateCache(serverDiscId);
          await message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.speech.voice_design.cleared_title",
              descriptionKey: "commands.speech.voice_design.cleared_description",
              descriptionVars: { persona: selectedPersona.persona_nickname },
              color: ColorCode.SUCCESS,
            }),
          );
        } catch (error) {
          if (error instanceof PersonaWorkflowUpdateError) throw error;
          const context: ErrorContext = {
            userId: userData.user_id,
            serverId: selectedPersona.server_id,
            personaId: selectedPersona.persona_id,
            errorType: "CommandExecutionError",
            metadata: {
              command: "speech voice-design remove",
              guildId: interaction.guild?.id ?? interaction.user.id,
              executorDiscordId: interaction.user.id,
            },
          };
          await log.error("Error executing /speech voice-design remove", error as Error, context);
          await message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.unknown_error_title",
              descriptionKey: "general.errors.unknown_error_description",
              color: ColorCode.ERROR,
            }),
          );
        }

        return completePersonaWorkflow();
      },
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: null,
      personaId: null,
      errorType: "CommandExecutionError",
      metadata: {
        command: "speech voice-design remove",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /speech voice-design remove", error as Error, context);
    if (personaWorkflowStarted) return;
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
