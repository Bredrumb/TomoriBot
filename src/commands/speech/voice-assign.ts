import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { sql } from "@/utils/db/client";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { loadAllPersonasForServer } from "@/utils/db/dbRead";
import { updateTomori } from "@/utils/db/dbWrite";
import {
  acknowledgeModalSubmitForRefresh,
  promptWithPaginatedModal,
  replyInfoEmbed,
  replyComponentsV2Status,
  type AvatarSessionCache,
  replyPaginatedPersonaChoicesV2,
  safeSelectOptionText,
} from "@/utils/discord/interactionHelper";
import { log, ColorCode } from "@/utils/misc/logger";
import { ELEVENLABS_SERVICE_NAME } from "@/utils/audio/elevenLabsAccount";
import { type ElevenLabsVoiceCatalogEntry, fetchElevenLabsVoiceCatalog } from "@/utils/audio/elevenLabsVoiceCatalog";
import { resolveActiveSpeechEndpoint } from "@/utils/provider/speechEndpointResolver";
import { getOptApiKey } from "@/utils/security/crypto";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import type { ModalResult, SelectOption } from "@/types/discord/modal";
import { localizer } from "@/utils/text/localizer";

const ELEVENLABS_MODAL_ID = "voice_assign_elevenlabs_modal";
const VOICE_SELECT_ID = "voice_select";
const CLEAR_VOICE_VALUE = "__clear__";

function buildVoiceDescription(voice: ElevenLabsVoiceCatalogEntry, locale: string): string {
  const parts = [voice.category, voice.labels.gender, voice.labels.age, voice.labels.accent]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());

  if (parts.length > 0) return safeSelectOptionText(parts.join(" | "));
  if (voice.description) return safeSelectOptionText(voice.description);
  return safeSelectOptionText(localizer(locale, "commands.config.voice.elevenlabs.voice_available_description"));
}

function buildVoiceOptions(voices: ElevenLabsVoiceCatalogEntry[], locale: string): SelectOption[] {
  return [
    {
      label: safeSelectOptionText(localizer(locale, "commands.speech.voice_assign.clear_choice_label")),
      value: CLEAR_VOICE_VALUE,
      description: safeSelectOptionText(localizer(locale, "commands.speech.voice_assign.clear_choice_description")),
    },
    ...voices.map((voice) => ({
      label: safeSelectOptionText(voice.name),
      value: voice.voiceId,
      description: buildVoiceDescription(voice, locale),
    })),
  ];
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("voice-assign").setDescription(localizer("en-US", "commands.speech.voice_assign.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  let selectedPersona: TomoriState | null = null;
  let modalResult: ModalResult | null = null;

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

    const serverId = allPersonas[0]?.server_id;
    if (!serverId) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Resolve the active speech endpoint to determine the voice source type.
    const speechEndpoint = await resolveActiveSpeechEndpoint(serverId);
    const apiStyle = speechEndpoint?.endpoint.api_style ?? null;

    // For elevenlabs endpoints, try the resolved API key then fall back to the
    // legacy opt_api_keys entry for servers that haven't run the seed migration yet.
    const elevenLabsApiKey =
      apiStyle === "elevenlabs"
        ? speechEndpoint?.apiKey || (await getOptApiKey(serverId, ELEVENLABS_SERVICE_NAME))
        : null;

    // Legacy fallback: if no custom speech endpoint is registered yet but the
    // server has an ElevenLabs opt key, treat it as an elevenlabs endpoint.
    const effectiveStyle =
      apiStyle ?? ((await getOptApiKey(serverId, ELEVENLABS_SERVICE_NAME)) !== null ? "elevenlabs" : null);

    if (!effectiveStyle) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.speech.voice_assign.no_speech_endpoint_title",
        descriptionKey: "commands.speech.voice_assign.no_speech_endpoint_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (effectiveStyle === "tts-clone") {
      // --- TTS clone path: all server samples available for assignment ---
      const sampleRows = await sql<{ sample_id: number; name: string; ref_text: string | null; duration_ms: number }[]>`
        SELECT sample_id, name, ref_text, duration_ms
        FROM voice_samples
        WHERE server_id = ${serverId}
        ORDER BY name
      `;

      if (!sampleRows.length) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.speech.voice_assign.no_sample_title",
          descriptionKey: "commands.speech.voice_assign.no_sample_description",
          color: ColorCode.WARN,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Persona picker loop.
      const avatarSessionCache: AvatarSessionCache = new Map();
      while (true) {
        const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
          personas: allPersonas,
          avatarSessionCache,
          color: ColorCode.INFO,
          preserveSelectedInteraction: true,
          titleKey: "commands.speech.voice_assign.select_persona_title",
          onSelect: async () => {},
        });
        if (!personaSelection.success) {
          if (personaSelection.reason === "cancelled" || personaSelection.reason === "fatal") return;
          continue;
        }
        if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) return;

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

        // Build options: clear + one entry per uploaded sample.
        const sampleOptions: SelectOption[] = [
          {
            label: safeSelectOptionText(localizer(locale, "commands.speech.voice_assign.clear_choice_label")),
            value: CLEAR_VOICE_VALUE,
            description: safeSelectOptionText(
              localizer(locale, "commands.speech.voice_assign.clear_choice_description"),
            ),
          },
          ...sampleRows.map((s) => {
            const durationLabel =
              s.duration_ms > 0 ? `${Math.floor(s.duration_ms / 1000)}s` : localizer(locale, "general.unknown");
            const hintKey = s.ref_text
              ? "commands.speech.voice_assign.sample_ref_hint_with"
              : "commands.speech.voice_assign.sample_ref_hint_without";
            return {
              label: safeSelectOptionText(s.name),
              value: String(s.sample_id),
              description: safeSelectOptionText(localizer(locale, hintKey, { duration: durationLabel })),
            };
          }),
        ];

        const sampleModal = await promptWithPaginatedModal(personaButtonInteraction, locale, {
          modalCustomId: "voice_assign_clone_modal",
          modalTitleKey: "commands.speech.voice_assign.assign_clone_title",
          components: [
            {
              customId: "sample_select",
              labelKey: "commands.speech.voice_assign.assign_clone_title",
              placeholder: "commands.speech.voice_assign.assign_clone_title",
              required: true,
              options: sampleOptions,
            },
          ],
        });

        if (sampleModal.outcome !== "submit" || !sampleModal.interaction) {
          await replyComponentsV2Status(
            interaction,
            locale,
            "general.pagination.select_persona_title",
            "general.pagination.reloading_persona_picker",
            ColorCode.INFO,
          );
          continue;
        }

        const chosenValue = sampleModal.values?.sample_select;
        const isClear = chosenValue === CLEAR_VOICE_VALUE;
        const chosenSample = isClear ? null : (sampleRows.find((s) => String(s.sample_id) === chosenValue) ?? null);
        const sampleIdToAssign = chosenSample?.sample_id ?? null;

        const voiceNameIfDesignPromptRemains = selectedPersona.speech_voice_design_prompt?.trim()
          ? "VoiceDesign"
          : null;
        const updatedTomori = await updateTomori(selectedPersona.tomori_id, {
          speech_voice_sample_id: sampleIdToAssign,
          // Keep any saved VoiceDesign prompt as reusable persona data. In auto
          // endpoint mode, speech_voice_name marks which saved voice type is
          // active, so assigning a sample makes clone synthesis the active path.
          ...(isClear
            ? { speech_voice_name: voiceNameIfDesignPromptRemains }
            : { speech_voice_id: null, speech_voice_name: chosenSample?.name ?? null }),
        });

        if (!updatedTomori) {
          await replyInfoEmbed(sampleModal.interaction, locale, {
            titleKey: "general.errors.update_failed_title",
            descriptionKey: "general.errors.update_failed_description",
            color: ColorCode.ERROR,
          });
          return;
        }

        invalidateTomoriStateCache(serverDiscId);
        await acknowledgeModalSubmitForRefresh(sampleModal.interaction);
        await replyComponentsV2Status(
          interaction,
          locale,
          isClear ? "commands.speech.voice_assign.cleared_title" : "commands.speech.voice_assign.success_title",
          isClear
            ? "commands.speech.voice_assign.cleared_description"
            : "commands.speech.voice_assign.success_description",
          ColorCode.SUCCESS,
          isClear
            ? { persona: selectedPersona.tomori_nickname }
            : { persona: selectedPersona.tomori_nickname, voice: chosenSample?.name ?? "" },
          "general.pagination.reloading_persona_picker",
        );
      }
    }

    // --- ElevenLabs path ---
    const activeElevenLabsKey = elevenLabsApiKey ?? (await getOptApiKey(serverId, ELEVENLABS_SERVICE_NAME));
    if (!activeElevenLabsKey) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.voice.elevenlabs.no_key_title",
        descriptionKey: "commands.config.voice.elevenlabs.no_key_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const voiceCatalogResult = await fetchElevenLabsVoiceCatalog(activeElevenLabsKey);
    if (!voiceCatalogResult.success || !voiceCatalogResult.voices?.length) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.speech.voice_assign.elevenlabs_voice_fetch_failed_title",
        descriptionKey: "commands.speech.voice_assign.elevenlabs_voice_fetch_failed_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const availableVoices = voiceCatalogResult.voices;

    while (true) {
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        titleKey: "commands.speech.voice_assign.select_persona_title",
        onSelect: async () => {},
      });
      if (!personaSelection.success) {
        if (personaSelection.reason === "cancelled" || personaSelection.reason === "fatal") return;
        continue;
      }
      if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) return;

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

      modalResult = await promptWithPaginatedModal(personaButtonInteraction, locale, {
        modalCustomId: ELEVENLABS_MODAL_ID,
        modalTitleKey: "commands.speech.voice_assign.elevenlabs_modal_title",
        components: [
          {
            customId: VOICE_SELECT_ID,
            labelKey: "commands.config.voice.elevenlabs.select_label",
            descriptionKey: "commands.config.voice.elevenlabs.select_description",
            placeholder: "commands.config.voice.elevenlabs.select_placeholder",
            required: true,
            options: buildVoiceOptions(availableVoices, locale),
          },
        ],
      });

      if (modalResult.outcome !== "submit" || !modalResult.interaction) {
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      const modalInteraction = modalResult.interaction;
      const selectedVoiceId = modalResult.values?.[VOICE_SELECT_ID];
      if (!selectedVoiceId) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      const isClear = selectedVoiceId === CLEAR_VOICE_VALUE;
      const chosenVoice = isClear ? null : (availableVoices.find((v) => v.voiceId === selectedVoiceId) ?? null);

      if (!isClear && !chosenVoice) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      const updatedTomori = await updateTomori(selectedPersona.tomori_id, {
        speech_voice_id: chosenVoice?.voiceId ?? null,
        speech_voice_name:
          chosenVoice?.name ?? (selectedPersona.speech_voice_design_prompt?.trim() ? "VoiceDesign" : null),
        elevenlabs_voice_id: chosenVoice?.voiceId ?? null,
        elevenlabs_voice_name: chosenVoice?.name ?? null,
        speech_voice_sample_id: null,
      });

      if (!updatedTomori) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      invalidateTomoriStateCache(serverDiscId);
      await acknowledgeModalSubmitForRefresh(modalInteraction);
      await replyComponentsV2Status(
        interaction,
        locale,
        isClear ? "commands.speech.voice_assign.cleared_title" : "commands.speech.voice_assign.success_title",
        isClear
          ? "commands.speech.voice_assign.cleared_description"
          : "commands.speech.voice_assign.success_description",
        ColorCode.SUCCESS,
        isClear
          ? { persona: selectedPersona.tomori_nickname }
          : { persona: selectedPersona.tomori_nickname, voice: chosenVoice?.name ?? "" },
        "general.pagination.reloading_persona_picker",
      );
    }
  } catch (error) {
    const errorReplyInteraction = modalResult?.interaction ?? interaction;
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: selectedPersona?.server_id ?? null,
      tomoriId: selectedPersona?.tomori_id ?? null,
      errorType: "CommandExecutionError",
      metadata: {
        command: "speech voice-assign",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
        selectedPersonaId: selectedPersona?.tomori_id ?? null,
      },
    };
    await log.error("Error executing /speech voice-assign", error as Error, context);
    await replyInfoEmbed(errorReplyInteraction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
