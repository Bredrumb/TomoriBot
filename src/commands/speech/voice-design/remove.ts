import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { loadAllPersonasForServer } from "@/utils/db/dbRead";
import { updateTomori } from "@/utils/db/dbWrite";
import { replyInfoEmbed, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/interactionHelper";
import { log, ColorCode } from "@/utils/misc/logger";
import { resolveActiveSpeechEndpoint } from "@/utils/provider/speechEndpointResolver";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
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
  let selectedPersona: TomoriState | null = null;

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

    const allPersonas = await loadAllPersonasForServer(serverDiscId);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
      personas: allPersonas,
      color: ColorCode.INFO,
      preserveSelectedInteraction: true,
      titleKey: "commands.speech.voice_design.select_persona_title",
      onSelect: async () => {},
    });

    if (!personaSelection.success || personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
      return;
    }

    const personaButtonInteraction = personaSelection.interaction as ButtonInteraction;
    selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
    if (!selectedPersona?.tomori_id) {
      await replyInfoEmbed(personaButtonInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const voiceNameIfOtherVoiceRemains = selectedPersona.speech_voice_sample_id
      ? selectedPersona.speech_voice_name === "VoiceDesign"
        ? "Voice Clone"
        : selectedPersona.speech_voice_name
      : selectedPersona.speech_voice_id?.trim()
        ? selectedPersona.speech_voice_name
        : null;

    const updatedTomori = await updateTomori(selectedPersona.tomori_id, {
      speech_voice_design_prompt: null,
      speech_voice_name: voiceNameIfOtherVoiceRemains,
    });

    if (!updatedTomori) {
      await replyInfoEmbed(personaButtonInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(serverDiscId);
    await replyInfoEmbed(personaButtonInteraction, locale, {
      titleKey: "commands.speech.voice_design.cleared_title",
      descriptionKey: "commands.speech.voice_design.cleared_description",
      descriptionVars: { persona: selectedPersona.tomori_nickname },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: selectedPersona?.server_id ?? null,
      tomoriId: selectedPersona?.tomori_id ?? null,
      errorType: "CommandExecutionError",
      metadata: {
        command: "speech voice-design remove",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /speech voice-design remove", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
