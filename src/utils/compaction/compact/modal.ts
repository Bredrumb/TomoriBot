import type { ChatInputCommandInteraction, ModalSubmitInteraction } from "discord.js";
import { MessageFlags, TextInputStyle } from "discord.js";
import type { CompactSummaryMode } from "@/types/misc/compact";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { localizer } from "@/utils/text/localizer";
import type { ModalComponent } from "@/types/discord/modal";

const MODAL_CUSTOM_ID = "tool_compact_modal";
const TYPE_FIELD_ID = "summary_type";
const REFRESH_FIELD_ID = "refresh_context";
const ANALYZE_IMAGES_FIELD_ID = "analyze_images";
const ADDITIONAL_INST_FIELD_ID = "additional_instructions";

export type CompactModalSelection = {
  submitInteraction: ModalSubmitInteraction;
  summaryType: CompactSummaryMode;
  refresh: boolean;
  analyzeImages: boolean;
  additionalInstructions?: string;
};

export async function promptForCompactOptions(
  interaction: ChatInputCommandInteraction,
  locale: string,
): Promise<CompactModalSelection | null> {
  const modalResult = await promptWithRawModal(
    interaction,
    locale,
    {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.tool.compact.modal.title",
      components: buildCompactModalComponents(locale),
    },
    MessageFlags.Ephemeral,
  );

  if (modalResult.outcome !== "submit") {
    return null;
  }

  const submitInteraction = modalResult.interaction;
  if (!submitInteraction || !modalResult.values) {
    return null;
  }

  return {
    submitInteraction,
    summaryType: (modalResult.values[TYPE_FIELD_ID] || "conversation") as CompactSummaryMode,
    refresh: (modalResult.multiValues?.[REFRESH_FIELD_ID] ?? []).includes("yes"),
    analyzeImages: (modalResult.multiValues?.[ANALYZE_IMAGES_FIELD_ID] ?? []).includes("yes"),
    additionalInstructions: modalResult.values[ADDITIONAL_INST_FIELD_ID]?.trim() || undefined,
  };
}

function buildCompactModalComponents(locale: string): ModalComponent[] {
  return [
    {
      kind: "radioGroup",
      customId: TYPE_FIELD_ID,
      labelKey: "commands.tool.compact.modal.type_label",
      descriptionKey: "commands.tool.compact.modal.type_description",
      required: true,
      options: [
        {
          label: localizer(locale, "commands.tool.compact.modal.type_choice_conversation"),
          value: "conversation",
        },
        {
          label: localizer(locale, "commands.tool.compact.modal.type_choice_roleplay"),
          value: "roleplay",
        },
      ],
    },
    {
      kind: "checkboxGroup",
      customId: REFRESH_FIELD_ID,
      labelKey: "commands.tool.compact.modal.refresh_label",
      descriptionKey: "commands.tool.compact.modal.refresh_description",
      minValues: 0,
      required: false,
      options: [{ label: localizer(locale, "general.yes"), value: "yes" }],
    },
    {
      kind: "checkboxGroup",
      customId: ANALYZE_IMAGES_FIELD_ID,
      labelKey: "commands.tool.compact.modal.analyze_images_label",
      descriptionKey: "commands.tool.compact.modal.analyze_images_description",
      minValues: 0,
      required: false,
      options: [{ label: localizer(locale, "general.yes"), value: "yes" }],
    },
    {
      customId: ADDITIONAL_INST_FIELD_ID,
      labelKey: "commands.tool.compact.modal.additional_instructions_label",
      placeholder: "commands.tool.compact.modal.additional_instructions_placeholder",
      required: false,
      style: TextInputStyle.Paragraph,
      maxLength: 1000,
    },
  ];
}
