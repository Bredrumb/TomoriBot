import { type ButtonInteraction, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { SummaryEmbedOptions } from "@/types/discord/embed";
import type { UserRow } from "@/types/db/schema";
import { personaRepository, personalMemoryRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { replyPaginatedStatusPages } from "@/utils/discord/ui/statusComponents";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { formatBooleanLocalized } from "@/utils/text/processors/formatters";
import { formatLlmDisplayLabel } from "@/utils/provider/modelDisplay";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import {
  ATTRIBUTE_TRUNCATE_LENGTH,
  DIALOGUE_TRUNCATE_LENGTH,
  formatBulletList,
  formatNumberedList,
  formatSampleDialogues,
  MAX_PROMPT_PREVIEW,
  MEMORY_TRUNCATE_LENGTH,
} from "@/utils/metrics/status/sharedFormatters";

export async function showPersonaStatus(
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  serverDiscId: string,
  locale: string,
): Promise<void> {
  const limits = getMemoryLimits();
  const allPersonas = await personaRepository.loadAllForServer(serverDiscId);

  if (allPersonas.length === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
    personas: allPersonas,
    color: ColorCode.INFO,
    preserveSelectedInteraction: true,
    onSelect: async () => {},
  });

  if (!personaSelection.success || personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
    return;
  }

  const personaInteraction: ButtonInteraction = personaSelection.interaction;
  const selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;

  if (!selectedPersona?.tomori_id) {
    await replyInfoEmbed(personaInteraction, locale, {
      titleKey: "general.errors.invalid_option_title",
      descriptionKey: "general.errors.invalid_option_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const personaName = selectedPersona.tomori_nickname;
  const personaLineageId = selectedPersona.persona_lineage_id ?? 0;

  let personaPersonalMemoryList: string[] = [];
  if (userData.user_id) {
    const personaPersonalMemoryRows = await personalMemoryRepository.loadForUserLineage(
      userData.user_id,
      personaLineageId,
      false,
    );
    personaPersonalMemoryList = personaPersonalMemoryRows.map((row) => row.content);
  }

  const personaServerMemoryList = selectedPersona.server_memories ?? [];

  const attributesCount = selectedPersona.attribute_list.length;
  const attributesValue = formatBulletList(selectedPersona.attribute_list, locale, ATTRIBUTE_TRUNCATE_LENGTH);

  const dialogueCount = Math.max(
    selectedPersona.sample_dialogues_in.length,
    selectedPersona.sample_dialogues_out.length,
  );
  const sampleDialoguesValue = formatSampleDialogues(
    selectedPersona.sample_dialogues_in,
    selectedPersona.sample_dialogues_out,
    locale,
    DIALOGUE_TRUNCATE_LENGTH,
  );

  const personaPersonalMemoriesCount = personaPersonalMemoryList.length;
  const personaPersonalMemoriesValue = formatNumberedList(personaPersonalMemoryList, locale, MEMORY_TRUNCATE_LENGTH);
  const personaServerMemoriesCount = personaServerMemoryList.length;
  const personaServerMemoriesValue = formatNumberedList(personaServerMemoryList, locale, MEMORY_TRUNCATE_LENGTH);

  const personaTriggersValue =
    selectedPersona.trigger_words.length > 0
      ? selectedPersona.trigger_words.map((t) => `\`${t}\``).join(", ")
      : localizer(locale, "commands.choices.none");

  const naiTagsValue =
    selectedPersona.nai_tags.length > 0
      ? selectedPersona.nai_tags.join(", ")
      : localizer(locale, "commands.choices.none");

  //     Shows the persona-specific LLM if set, otherwise "Server default"
  const personaModelValue = selectedPersona.persona_llm
    ? formatLlmDisplayLabel(
        selectedPersona.persona_llm,
        selectedPersona.config.custom_model_name,
        selectedPersona.config.other_model_codename,
      )
    : localizer(locale, "commands.tool.status.persona_model_server_default");

  //     Each field is shown individually; null fields display as "None"
  const noneLabel = localizer(locale, "commands.choices.none");
  const attgAuthor = selectedPersona.nai_attg_author ?? noneLabel;
  const attgTitle = selectedPersona.nai_attg_title ?? noneLabel;
  const attgTags = selectedPersona.nai_attg_tags ?? noneLabel;
  const attgGenre = selectedPersona.nai_attg_genre ?? noneLabel;
  const attgStars = selectedPersona.nai_attg_stars != null ? `${selectedPersona.nai_attg_stars}★` : noneLabel;
  const attgAllUnset =
    !selectedPersona.nai_attg_author &&
    !selectedPersona.nai_attg_title &&
    !selectedPersona.nai_attg_tags &&
    !selectedPersona.nai_attg_genre &&
    selectedPersona.nai_attg_stars == null;
  const attgValue = attgAllUnset
    ? localizer(locale, "commands.tool.status.nai_attg_not_set")
    : `Author: ${attgAuthor}\nTitle: ${attgTitle}\nTags: ${attgTags}\nGenre: ${attgGenre}\nStars: ${attgStars}`;

  const rawPersonaPrompt = selectedPersona.persona_prompt ?? null;
  const personaPromptValue = rawPersonaPrompt
    ? `\`\`\`\n${
        rawPersonaPrompt.length > MAX_PROMPT_PREVIEW
          ? `${rawPersonaPrompt.slice(0, MAX_PROMPT_PREVIEW)}...`
          : rawPersonaPrompt
      }\n\`\`\``
    : localizer(locale, "commands.tool.status.field_persona_prompt_not_set");

  const rawPersonaContextNote = selectedPersona.context_note ?? null;
  const personaContextNoteValue = rawPersonaContextNote
    ? `\`\`\`\n${
        rawPersonaContextNote.length > MAX_PROMPT_PREVIEW
          ? `${rawPersonaContextNote.slice(0, MAX_PROMPT_PREVIEW)}...`
          : rawPersonaContextNote
      }\n\`\`\``
    : localizer(locale, "commands.tool.status.field_persona_context_note_not_set");

  const personaPage1: SummaryEmbedOptions = {
    titleKey: "commands.tool.status.persona_page1_title",
    titleVars: { persona_name: personaName },
    descriptionKey: "commands.tool.status.persona_page1_description",
    color: ColorCode.INFO,
    fields: [
      {
        nameKey: "commands.tool.status.field_nickname",
        value: personaName,
        inline: true,
      },
      {
        nameKey: "commands.tool.status.field_is_alter",
        value: formatBooleanLocalized(selectedPersona.is_alter, locale),
        inline: true,
      },
      {
        nameKey: "commands.tool.status.field_persona_triggers",
        value: personaTriggersValue,
        inline: true,
      },
      {
        nameKey: "commands.tool.status.field_persona_model",
        value: personaModelValue,
        inline: true,
      },
      {
        nameKey: "commands.tool.status.field_avatar",
        value: selectedPersona.webhook_avatar_url
          ? localizer(locale, "general.yes")
          : localizer(locale, "commands.choices.none"),
        inline: true,
      },
      {
        nameKey: "commands.tool.status.field_voice",
        value:
          selectedPersona.speech_voice_name ??
          selectedPersona.elevenlabs_voice_name ??
          localizer(locale, "commands.choices.none"),
        inline: true,
      },
      {
        nameKey: "commands.tool.status.field_persona_nai_ref",
        value: formatBooleanLocalized(!!selectedPersona.nai_char_ref_url, locale),
        inline: true,
      },
      {
        nameKey: "commands.tool.status.field_reward_conditioning",
        value: formatBooleanLocalized(selectedPersona.reward_conditioning_enabled ?? true, locale),
        inline: true,
      },
      {
        nameKey: "commands.tool.status.field_punish_conditioning",
        value: formatBooleanLocalized(selectedPersona.punish_conditioning_enabled ?? true, locale),
        inline: true,
      },
    ],
  };

  const personaPage2: SummaryEmbedOptions = {
    titleKey: "commands.tool.status.persona_page2_title",
    titleVars: { persona_name: personaName },
    descriptionKey: "commands.tool.status.persona_page2_description",
    color: ColorCode.INFO,
    footerKey: "commands.tool.status.export_footer_persona_attributes_and_dialogues",
    fields: [
      {
        nameKey: "commands.tool.status.field_attributes_with_count",
        nameVars: {
          current: attributesCount,
          max: limits.maxAttributes,
        },
        value: attributesValue,
        inline: false,
      },
    ],
  };

  const personaPage3: SummaryEmbedOptions = {
    titleKey: "commands.tool.status.persona_page3_title",
    titleVars: { persona_name: personaName },
    descriptionKey: "commands.tool.status.persona_page3_description",
    color: ColorCode.INFO,
    footerKey: "commands.tool.status.export_footer_persona_attributes_and_dialogues",
    fields: [
      {
        nameKey: "commands.tool.status.field_sample_dialogues_with_count",
        nameVars: {
          current: dialogueCount,
          max: limits.maxSampleDialogues,
        },
        value: sampleDialoguesValue,
        inline: false,
      },
    ],
  };

  const personaPage4: SummaryEmbedOptions = {
    titleKey: "commands.tool.status.persona_page4_title",
    titleVars: { persona_name: personaName },
    descriptionKey: "commands.tool.status.persona_page4_description",
    color: ColorCode.INFO,
    footerKey: "commands.tool.status.export_footer_persona_memories",
    fields: [
      {
        nameKey: "commands.tool.status.field_persona_personal_memories_with_count",
        nameVars: {
          current: personaPersonalMemoriesCount,
          max: limits.maxPersonalMemories,
        },
        value: personaPersonalMemoriesValue,
        inline: false,
      },
      {
        nameKey: "commands.tool.status.field_persona_server_memories_with_count",
        nameVars: {
          current: personaServerMemoriesCount,
          max: limits.maxServerMemories,
        },
        value: personaServerMemoriesValue,
        inline: false,
      },
    ],
  };

  const personaPage5: SummaryEmbedOptions = {
    titleKey: "commands.tool.status.persona_page5_title",
    titleVars: { persona_name: personaName },
    descriptionKey: "commands.tool.status.persona_page5_description",
    color: ColorCode.INFO,
    fields: [
      {
        nameKey: "commands.tool.status.field_persona_prompt",
        value: personaPromptValue,
        inline: false,
      },
      {
        nameKey: "commands.tool.status.field_nai_tags",
        value: naiTagsValue,
        inline: false,
      },
      {
        nameKey: "commands.tool.status.field_nai_attg",
        value: attgValue,
        inline: false,
      },
      {
        nameKey: "commands.tool.status.field_persona_context_note",
        value: personaContextNoteValue,
        inline: false,
      },
      {
        nameKey: "commands.tool.status.field_persona_context_note_depth",
        value: String(selectedPersona.context_note_depth ?? 0),
        inline: true,
      },
    ],
  };

  await replyPaginatedStatusPages(
    personaInteraction,
    locale,
    [personaPage1, personaPage2, personaPage3, personaPage4, personaPage5],
    MessageFlags.Ephemeral,
  );
}
