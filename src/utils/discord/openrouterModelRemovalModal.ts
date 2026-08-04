import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";
import type {
  OpenRouterModelCapability,
  RegisteredOpenRouterModelEntry,
} from "@/utils/provider/openrouterModelRegistry";

const MAX_OPTIONS_PER_GROUP = 10;
export const MAX_OPENROUTER_MODEL_GROUPS = 5;
const OPENROUTER_MODEL_REMOVE_CHECKBOX_PREFIX = "openrouter_model_remove_group";

function truncateModalText(value: string | null | undefined, maxLength = 100): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function getCapabilityLabelKey(capability: OpenRouterModelCapability, continued: boolean): string {
  switch (capability) {
    case "text":
      return continued
        ? "commands.openrouter.models.remove.checkbox_text_label_continued"
        : "commands.openrouter.models.remove.checkbox_text_label";
    case "embedding":
      return continued
        ? "commands.openrouter.models.remove.checkbox_embedding_label_continued"
        : "commands.openrouter.models.remove.checkbox_embedding_label";
    case "image":
      return continued
        ? "commands.openrouter.models.remove.checkbox_image_label_continued"
        : "commands.openrouter.models.remove.checkbox_image_label";
    case "video":
      return continued
        ? "commands.openrouter.models.remove.checkbox_video_label_continued"
        : "commands.openrouter.models.remove.checkbox_video_label";
  }
}

function buildCheckboxOptions(models: RegisteredOpenRouterModelEntry[]): CheckboxGroupOption[] {
  return models.map((model) => ({
    value: `${model.capability}:${model.modelId}`,
    label: truncateModalText(model.codename, 100),
    description: truncateModalText(model.description ?? model.codename, 100),
    default: true,
  }));
}

export function buildOpenRouterModelCheckboxGroups(
  models: RegisteredOpenRouterModelEntry[],
): ModalCheckboxGroupField[] {
  const groups: ModalCheckboxGroupField[] = [];
  const groupedCapabilities: OpenRouterModelCapability[] = ["text", "embedding", "image", "video"];
  let firstGroup = true;

  for (const capability of groupedCapabilities) {
    const capabilityModels = models.filter((model) => model.capability === capability);
    if (capabilityModels.length === 0) {
      continue;
    }

    for (let i = 0; i < capabilityModels.length; i += MAX_OPTIONS_PER_GROUP) {
      const chunk = capabilityModels.slice(i, i + MAX_OPTIONS_PER_GROUP);
      const chunkIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);

      groups.push({
        kind: "checkboxGroup",
        customId: `${OPENROUTER_MODEL_REMOVE_CHECKBOX_PREFIX}_${groups.length}`,
        labelKey: getCapabilityLabelKey(capability, chunkIndex > 0),
        descriptionKey: firstGroup ? "commands.openrouter.models.remove.checkbox_description" : undefined,
        minValues: 0,
        required: false,
        options: buildCheckboxOptions(chunk),
      });

      firstGroup = false;
    }
  }

  return groups;
}

export function collectCheckedOpenRouterModelValues(
  multiValues: Record<string, string[]> | undefined,
  groupCount: number,
): Set<string> {
  const checkedValues = new Set<string>();

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const values = multiValues?.[`${OPENROUTER_MODEL_REMOVE_CHECKBOX_PREFIX}_${groupIndex}`] ?? [];
    for (const value of values) {
      checkedValues.add(value);
    }
  }

  return checkedValues;
}
