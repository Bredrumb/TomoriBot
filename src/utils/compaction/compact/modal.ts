import type { ChatInputCommandInteraction, ModalSubmitInteraction } from "discord.js";
import { MessageFlags, TextInputStyle } from "discord.js";
import type { CompactSummaryMode } from "@/types/misc/compact";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { localizer } from "@/utils/text/localizer";
import type { ModalComponent } from "@/types/discord/modal";

const MODAL_CUSTOM_ID = "tool_compact_modal";
const REFRESH_FIELD_ID = "refresh_context";
const ANALYZE_IMAGES_FIELD_ID = "analyze_images";
const SYSTEM_PROMPT_FIELD_ID = "system_prompt";

const DEFAULT_CONVERSATION_SYSTEM_PROMPT =
  "You are a skilled conversation analyst who creates clear, readable summaries of Discord conversations. " +
  "Your goal is to distill the conversation into a well-written, human-readable narrative that captures the essential elements: " +
  "key facts, relationships between participants, important decisions, ongoing tasks, and the overall flow of discussion. " +
  "Write in natural prose that's easy to understand, avoiding unnecessary jargon or robotic phrasing. " +
  "Be concise but thorough: every sentence should add value. Output plain text only.";

const DEFAULT_ROLEPLAY_SYSTEM_PROMPT =
  "You are a skilled storyteller who crafts clear, engaging summaries of roleplay scenes. " +
  "Analyze the roleplay narrative and produce a structured JSON summary that captures the scene. " +
  "Write with clarity and literary quality: your description should paint a vivid picture while remaining concise. " +
  "Base every detail on what's actually present in the context; if something isn't shown, note that it is unclear. " +
  "The JSON structure should contain a single field:\n" +
  "- overall_scene_summary: A narrative overview of the current scene, setting, atmosphere, and what's happening";

export { DEFAULT_CONVERSATION_SYSTEM_PROMPT, DEFAULT_ROLEPLAY_SYSTEM_PROMPT };

export type CompactModalSelection = {
  submitInteraction: ModalSubmitInteraction;
  summaryType: CompactSummaryMode;
  refresh: boolean;
  analyzeImages: boolean;
  systemPrompt: string;
};

export async function promptForCompactOptions(
  interaction: ChatInputCommandInteraction,
  locale: string,
  summaryType: CompactSummaryMode,
): Promise<CompactModalSelection | null> {
  const modalResult = await promptWithRawModal(
    interaction,
    locale,
    {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.tool.compact.modal.title",
      components: buildCompactModalComponents(locale, summaryType),
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

  const defaultSystemPrompt =
    summaryType === "roleplay" ? DEFAULT_ROLEPLAY_SYSTEM_PROMPT : DEFAULT_CONVERSATION_SYSTEM_PROMPT;

  return {
    submitInteraction,
    summaryType,
    refresh: (modalResult.multiValues?.[REFRESH_FIELD_ID] ?? []).includes("yes"),
    analyzeImages: (modalResult.multiValues?.[ANALYZE_IMAGES_FIELD_ID] ?? []).includes("yes"),
    systemPrompt: modalResult.values[SYSTEM_PROMPT_FIELD_ID]?.trim() || defaultSystemPrompt,
  };
}

function buildCompactModalComponents(locale: string, summaryType: CompactSummaryMode): ModalComponent[] {
  const defaultSystemPrompt =
    summaryType === "roleplay" ? DEFAULT_ROLEPLAY_SYSTEM_PROMPT : DEFAULT_CONVERSATION_SYSTEM_PROMPT;

  return [
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
      customId: SYSTEM_PROMPT_FIELD_ID,
      labelKey: "commands.tool.compact.modal.system_prompt_label",
      placeholder: "commands.tool.compact.modal.system_prompt_placeholder",
      required: false,
      style: TextInputStyle.Paragraph,
      maxLength: 2000,
      value: defaultSystemPrompt,
    },
  ];
}
