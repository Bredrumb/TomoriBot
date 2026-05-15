import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags, TextInputStyle } from "discord.js";
import type { UserRow, TomoriState } from "@/types/db/schema";
import { log, ColorCode } from "@/utils/misc/logger";
import { acknowledgeModalSubmitForRefresh, promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyComponentsV2Status, updateButtonComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository } from "@/utils/db/repositories";
import { sql } from "@/utils/db/client";
import { localizer } from "@/utils/text/localizer";
import { combineModalPromptParts, splitPromptIntoModalParts } from "@/utils/text/modalPromptParts";

const MODAL_CUSTOM_ID = "teach_personaprompt_modal";
const PERSONA_PROMPT_INPUT_IDS = [
  "persona_prompt_part1",
  "persona_prompt_part2",
  "persona_prompt_part3",
  "persona_prompt_part4",
] as const;
const PERSONA_PROMPT_PART_MAX_LENGTH = 4000;
const LEGACY_PERSONA_DESCRIPTION_PREFIX = "{bot}'s Description: ";

function resolvePrefillPrompt(persona: TomoriState): string | null {
  if (persona.persona_prompt?.trim()) {
    return persona.persona_prompt.trim();
  }

  const legacyDescription = persona.attribute_list.find((attribute) =>
    attribute.startsWith(LEGACY_PERSONA_DESCRIPTION_PREFIX),
  );
  if (!legacyDescription) {
    return null;
  }

  const extractedDescription = legacyDescription.slice(LEGACY_PERSONA_DESCRIPTION_PREFIX.length).trim();
  return extractedDescription.length > 0 ? extractedDescription : null;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("set").setDescription(localizer("en-US", "commands.persona.prompt.set.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
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

  if (interaction.guild) {
    const hasPermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
    if (!hasPermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.teach.personaprompt.no_permission_title",
        descriptionKey: "commands.teach.personaprompt.no_permission_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  let tomoriState: TomoriState | null = null;
  let personaSelectionInteraction: ButtonInteraction | null = null;
  let modalSubmitInteraction: ModalSubmitInteraction | undefined;
  try {
    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const avatarSessionCache: AvatarSessionCache = new Map();
    while (true) {
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        avatarSessionCache,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success) {
        if (personaSelection.reason === "cancelled" || personaSelection.reason === "fatal") return;
        continue;
      }
      if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
        return;
      }

      personaSelectionInteraction = personaSelection.interaction;
      const selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;

      if (!selectedPersona?.tomori_id) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "general.errors.invalid_option_title",
          "general.errors.invalid_option_description",
          ColorCode.ERROR,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      const existingPromptParts = splitPromptIntoModalParts(
        resolvePrefillPrompt(selectedPersona),
        PERSONA_PROMPT_INPUT_IDS.length,
        PERSONA_PROMPT_PART_MAX_LENGTH,
      );

      const modalResult = await promptWithRawModal(personaSelectionInteraction, locale, {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.teach.personaprompt.modal_title",
        components: [
          {
            customId: PERSONA_PROMPT_INPUT_IDS[0],
            labelKey: "commands.teach.personaprompt.part1_label",
            descriptionKey: "commands.teach.personaprompt.part1_description",
            placeholder: "commands.teach.personaprompt.part1_placeholder",
            style: TextInputStyle.Paragraph,
            required: false,
            maxLength: PERSONA_PROMPT_PART_MAX_LENGTH,
            value: existingPromptParts[0] || undefined,
          },
          {
            customId: PERSONA_PROMPT_INPUT_IDS[1],
            labelKey: "commands.teach.personaprompt.part2_label",
            placeholder: "commands.teach.personaprompt.part2_placeholder",
            style: TextInputStyle.Paragraph,
            required: false,
            maxLength: PERSONA_PROMPT_PART_MAX_LENGTH,
            value: existingPromptParts[1] || undefined,
          },
          {
            customId: PERSONA_PROMPT_INPUT_IDS[2],
            labelKey: "commands.teach.personaprompt.part3_label",
            placeholder: "commands.teach.personaprompt.part3_placeholder",
            style: TextInputStyle.Paragraph,
            required: false,
            maxLength: PERSONA_PROMPT_PART_MAX_LENGTH,
            value: existingPromptParts[2] || undefined,
          },
          {
            customId: PERSONA_PROMPT_INPUT_IDS[3],
            labelKey: "commands.teach.personaprompt.part4_label",
            placeholder: "commands.teach.personaprompt.part4_placeholder",
            style: TextInputStyle.Paragraph,
            required: false,
            maxLength: PERSONA_PROMPT_PART_MAX_LENGTH,
            value: existingPromptParts[3] || undefined,
          },
        ],
      });

      if (modalResult.outcome !== "submit") {
        log.info(`Teach personaprompt modal ${modalResult.outcome} for user ${interaction.user.id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      modalSubmitInteraction = modalResult.interaction;
      const personaPrompt = combineModalPromptParts(
        PERSONA_PROMPT_INPUT_IDS.map((inputId) => modalResult.values?.[inputId] || ""),
        PERSONA_PROMPT_PART_MAX_LENGTH,
      );
      if (!modalSubmitInteraction) {
        return;
      }

      await sql`
			  INSERT INTO persona_configs (tomori_id, persona_prompt)
			  VALUES (${selectedPersona.tomori_id}, ${personaPrompt || null})
			  ON CONFLICT (tomori_id) DO UPDATE
			  SET persona_prompt = EXCLUDED.persona_prompt
		  `;

      invalidateTomoriStateCache(serverDiscId);

      await acknowledgeModalSubmitForRefresh(modalSubmitInteraction);
      await replyComponentsV2Status(
        interaction,
        locale,
        personaPrompt ? "commands.teach.personaprompt.success_title" : "commands.forget.personaprompt.success_title",
        personaPrompt
          ? "commands.teach.personaprompt.success_description"
          : "commands.forget.personaprompt.success_description",
        ColorCode.SUCCESS,
        { persona_name: selectedPersona.tomori_nickname },
        "general.pagination.reloading_persona_picker",
      );
    }
  } catch (error) {
    await log.error("Error in /teach personaprompt command", error, {
      serverId: tomoriState?.server_id,
      tomoriId: tomoriState?.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "teach personaprompt",
        guildId: interaction.guild?.id,
        userId: interaction.user.id,
      },
    });

    const errorReplyTarget =
      modalSubmitInteraction ??
      (personaSelectionInteraction && !personaSelectionInteraction.deferred && !personaSelectionInteraction.replied
        ? personaSelectionInteraction
        : interaction);
    await replyInfoEmbed(errorReplyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
