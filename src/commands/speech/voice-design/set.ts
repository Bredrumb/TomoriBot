import {
  MessageFlags,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { loadAllPersonasForServer } from "@/utils/db/dbRead";
import { updateTomori } from "@/utils/db/dbWrite";
import { promptWithRawModal, replyInfoEmbed, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/interactionHelper";
import { log, ColorCode } from "@/utils/misc/logger";
import { resolveActiveSpeechEndpoint } from "@/utils/provider/speechEndpointResolver";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";

const PROMPT_MODAL_ID = "speech_voice_design_prompt_modal";
const PROMPT_FIELD_ID = "voice_design_prompt";
const MAX_VOICE_DESIGN_PROMPT_LENGTH = 1000;

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("set")
    .setDescription(localizer("en-US", "commands.speech.voice-design.set.description"))
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription(localizer("en-US", "commands.speech.voice_design.prompt_description"))
        .setRequired(false)
        .setMaxLength(MAX_VOICE_DESIGN_PROMPT_LENGTH),
    );

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

    const inlinePrompt = interaction.options.getString("prompt")?.trim() ?? "";

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

    let designPrompt = inlinePrompt;
    if (!designPrompt) {
      const existingPrompt = selectedPersona.speech_voice_design_prompt?.trim() ?? "";
      const modalResult = await promptWithRawModal(personaButtonInteraction, locale, {
        modalCustomId: PROMPT_MODAL_ID,
        modalTitleKey: existingPrompt
          ? "commands.speech.voice_design.update_modal_title"
          : "commands.speech.voice_design.modal_title",
        components: [
          {
            customId: PROMPT_FIELD_ID,
            labelKey: "commands.speech.voice_design.prompt_label",
            descriptionKey: "commands.speech.voice_design.prompt_help",
            placeholder: "commands.speech.voice_design.prompt_placeholder",
            style: TextInputStyle.Paragraph,
            required: true,
            minLength: 10,
            maxLength: MAX_VOICE_DESIGN_PROMPT_LENGTH,
            value: existingPrompt.slice(0, MAX_VOICE_DESIGN_PROMPT_LENGTH),
          },
        ],
      });

      if (modalResult.outcome !== "submit" || !modalResult.interaction) {
        return;
      }

      designPrompt = modalResult.values?.[PROMPT_FIELD_ID]?.trim() ?? "";
      if (!designPrompt) {
        await replyInfoEmbed(modalResult.interaction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "commands.speech.voice_design.prompt_required_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      await saveVoiceDesignPrompt(modalResult.interaction, locale, serverDiscId, selectedPersona, designPrompt);
      return;
    }

    await saveVoiceDesignPrompt(personaButtonInteraction, locale, serverDiscId, selectedPersona, designPrompt);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: selectedPersona?.server_id ?? null,
      tomoriId: selectedPersona?.tomori_id ?? null,
      errorType: "CommandExecutionError",
      metadata: {
        command: "speech voice-design set",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /speech voice-design set", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function saveVoiceDesignPrompt(
  responseInteraction: ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction,
  locale: string,
  serverDiscId: string,
  selectedPersona: TomoriState,
  designPrompt: string,
): Promise<void> {
  if (!selectedPersona.tomori_id) {
    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: "general.errors.invalid_option_title",
      descriptionKey: "general.errors.invalid_option_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // Keep clone/provider voice assignments as reusable persona data. In auto
  // endpoint mode, speech_voice_name marks VoiceDesign as the active voice
  // choice while preserving any saved sample/provider voice for later.
  const updatedTomori = await updateTomori(selectedPersona.tomori_id, {
    speech_voice_design_prompt: designPrompt,
    speech_voice_name: "VoiceDesign",
  });

  if (!updatedTomori) {
    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  invalidateTomoriStateCache(serverDiscId);
  await replyInfoEmbed(responseInteraction, locale, {
    titleKey: "commands.speech.voice_design.success_title",
    descriptionKey: "commands.speech.voice_design.success_description",
    descriptionVars: {
      persona: selectedPersona.tomori_nickname,
      preview: designPrompt.length > 120 ? `${designPrompt.slice(0, 117)}...` : designPrompt,
    },
    color: ColorCode.SUCCESS,
  });
}
