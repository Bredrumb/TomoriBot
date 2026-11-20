import {
  ButtonStyle,
  ComponentType,
  type ActionRowData,
  type ButtonComponentData,
  type ComponentInContainerData,
  type StringSelectMenuComponentData,
  type TextDisplayComponentData,
} from "discord.js";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";

// Postgres real widens floats (such as 0.6) past Discord's 10-char modal input limit (50035), so 7 significant digits
// recover binary32 without truncation.
export function formatStoredParameterValue(value: number): string {
  return String(Number(value.toPrecision(7)));
}

interface ProviderParameterOption {
  value: string;
  label: string;
  default?: boolean;
}

export interface ProviderParameterBlockCopy {
  providerLabel: string;
  providerSelectPlaceholder: string;
  samplingLabel: string;
  temperatureLabel: string;
  minPLabel: string;
  topPLabel: string;
  topKLabel: string;
  generationLabel: string;
  frequencyLabel: string;
  presenceLabel: string;
  maxOutputLabel: string;
  thinkingLabel: string;
  editSamplingLabel: string;
  editGenerationLabel: string;
}

interface ProviderParameterBlockValues {
  providerDisplayName: string;
  temperature: string;
  minP: string;
  topP: string;
  topK: string;
  frequency: string;
  presence: string;
  maxOutput: string;
  thinking: string;
}

interface ProviderParameterBlockRoutes {
  providerSelect: string;
  editSampling: string;
  editGeneration: string;
}

export interface ProviderParameterBlockInput {
  providerOptions: readonly ProviderParameterOption[];
  copy: ProviderParameterBlockCopy;
  values: ProviderParameterBlockValues;
  routes: ProviderParameterBlockRoutes;
  writesDisabled: boolean;
}

function buildSummary(
  copy: ProviderParameterBlockCopy,
  values: ProviderParameterBlockValues,
): TextDisplayComponentData {
  return {
    type: ComponentType.TextDisplay,
    content: `> ${copy.samplingLabel}: ${copy.temperatureLabel} \`${values.temperature}\` · ${copy.minPLabel} \`${values.minP}\`
> ${copy.topPLabel} \`${values.topP}\` · ${copy.topKLabel} \`${values.topK}\`
> ${copy.generationLabel}: ${copy.frequencyLabel} \`${values.frequency}\` · ${copy.presenceLabel} \`${values.presence}\`
> ${copy.maxOutputLabel} \`${values.maxOutput}\` · ${copy.thinkingLabel} \`${values.thinking}\``,
  };
}

function buildEditorButtons(
  copy: ProviderParameterBlockCopy,
  routes: ProviderParameterBlockRoutes,
  writesDisabled: boolean,
): ActionRowData<ButtonComponentData> {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: routes.editSampling,
        label: copy.editSamplingLabel,
        disabled: writesDisabled,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: routes.editGeneration,
        label: copy.editGenerationLabel,
        disabled: writesDisabled,
      },
    ],
  };
}

export function buildProviderParameterBlock(input: ProviderParameterBlockInput): ComponentInContainerData[] {
  if (input.providerOptions.length === 0) return [];

  const providerComponent: ComponentInContainerData =
    input.providerOptions.length > 1
      ? ({
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.StringSelect,
              customId: input.routes.providerSelect,
              placeholder: safeSelectOptionText(input.copy.providerSelectPlaceholder, 100),
              options: input.providerOptions.map((option) => ({
                ...option,
                label: safeSelectOptionText(option.label, 100),
              })),
              disabled: input.writesDisabled,
            },
          ],
        } satisfies ActionRowData<StringSelectMenuComponentData>)
      : {
          type: ComponentType.TextDisplay,
          content: `> ${input.copy.providerLabel}: \`${input.values.providerDisplayName}\``,
        };

  return [
    providerComponent,
    buildSummary(input.copy, input.values),
    buildEditorButtons(input.copy, input.routes, input.writesDisabled),
  ];
}
