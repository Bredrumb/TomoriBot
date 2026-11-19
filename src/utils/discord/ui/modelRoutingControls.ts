import {
  ComponentType,
  type ActionRowData,
  type SelectMenuComponentOptionData,
  type StringSelectMenuComponentData,
} from "discord.js";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { localizer } from "@/utils/text/localizer";

export interface ProviderSelectEntry {
  value: string;
  label: string;
}

export interface ProviderPageEntriesInput {
  providers: readonly string[];
  expandedProvider: string | null;
  expandedOptionCount: number;
  pageSize: number;
  locale: string;
  pageLabelKey: string;
  encodeProviderValue(provider: string): string;
  encodePageValue(provider: string, start: number): string;
}

export interface ProviderPageEntriesResult {
  entries: ProviderSelectEntry[];
  expandedStartIndex: number;
  expandedPageCount: number;
}

// Providers over 25 models expand into per-page entries because modal selects cap at 25 options and parked pagination
// rows cannot reopen their own page.
export function buildProviderPageEntries(input: ProviderPageEntriesInput): ProviderPageEntriesResult {
  const expanded = input.expandedProvider && input.expandedOptionCount > input.pageSize ? input.expandedProvider : null;
  const pageCount = expanded ? Math.ceil(input.expandedOptionCount / input.pageSize) : 0;

  const entries: ProviderSelectEntry[] = [];
  let expandedStartIndex = 0;
  let matchedExpanded = false;

  for (const provider of input.providers) {
    if (expanded && provider.toLowerCase() === expanded.toLowerCase()) {
      matchedExpanded = true;
      expandedStartIndex = entries.length;
      for (let page = 0; page < pageCount; page += 1) {
        entries.push({
          value: input.encodePageValue(provider, page * input.pageSize),
          label: safeSelectOptionText(
            localizer(input.locale, input.pageLabelKey, {
              provider: getProviderDisplayName(provider, input.locale),
              page: page + 1,
            }),
            100,
          ),
        });
      }
      continue;
    }
    entries.push({
      value: input.encodeProviderValue(provider),
      label: safeSelectOptionText(getProviderDisplayName(provider, input.locale), 100),
    });
  }

  return { entries, expandedStartIndex, expandedPageCount: matchedExpanded ? pageCount : 0 };
}

export interface ModelRoutingControlInput {
  locale: string;
  capabilityLabel: string;
  activeModelName: string | null;
  activeProvider: string | null;
  eligibleProviders?: readonly string[];
  providerEntries?: readonly ProviderSelectEntry[];
  customId: string;
  serverDefaultValue?: string;
  serverDefaultLabel?: string;
  serverDefaultDescription?: string;
  serverDefaultDisplay: string;
  placeholderOverride?: string;
  providerOverflowValue?: string;
  providerOverflowLabel?: string;
  directProviderLimit?: number;
  encodeProviderValue?(provider: string): string;
  disabled: boolean;
}

export function formatModelSelectionLabel(
  model: string | null,
  providerLabel: string | null,
  emptyLabel: string,
): string {
  return model ? `${model}${providerLabel ? ` (${providerLabel})` : ""}` : emptyLabel;
}

export function buildModelRoutingControl(
  input: ModelRoutingControlInput,
): ActionRowData<StringSelectMenuComponentData> {
  const activeModel = formatModelSelectionLabel(
    input.activeModelName,
    input.activeProvider ? getProviderDisplayName(input.activeProvider, input.locale) : null,
    input.serverDefaultDisplay,
  );
  const options: SelectMenuComponentOptionData[] = [];
  if (input.serverDefaultValue !== undefined && input.serverDefaultLabel !== undefined) {
    options.push({
      value: input.serverDefaultValue,
      label: safeSelectOptionText(input.serverDefaultLabel, 100),
      description: input.serverDefaultDescription
        ? safeSelectOptionText(input.serverDefaultDescription, 100)
        : undefined,
    });
  }

  if (
    input.providerOverflowValue &&
    input.directProviderLimit !== undefined &&
    (input.eligibleProviders?.length ?? 0) > input.directProviderLimit
  ) {
    options.push({
      value: input.providerOverflowValue,
      label: safeSelectOptionText(input.providerOverflowLabel ?? "", 100),
    });
  } else if (input.providerEntries) {
    options.push(
      ...input.providerEntries.map((entry) => ({
        value: entry.value,
        label: safeSelectOptionText(entry.label, 100),
      })),
    );
  } else {
    options.push(
      ...(input.eligibleProviders ?? []).map((provider) => ({
        value: input.encodeProviderValue?.(provider) ?? provider,
        label: safeSelectOptionText(getProviderDisplayName(provider, input.locale), 100),
      })),
    );
  }

  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        customId: input.customId,
        placeholder: safeSelectOptionText(input.placeholderOverride ?? `${input.capabilityLabel}: ${activeModel}`, 150),
        options,
        disabled: input.disabled,
      },
    ],
  };
}
