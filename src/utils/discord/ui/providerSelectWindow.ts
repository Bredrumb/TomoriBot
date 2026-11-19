import type { ProviderSelectEntry } from "@/utils/discord/ui/modelRoutingControls";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { localizer } from "@/utils/text/localizer";

export interface ProviderSelectWindowInput {
  entries: readonly ProviderSelectEntry[];
  entryStart: number;
  directLimit: number;
  expandedProvider: string | null;
  expandedPageCount: number;
  locale: string;
  capabilityLabel: string;
  pagePlaceholderKey: string;
  encodeAdvanceValue(start: number, expandedProvider: string | null): string;
}

export interface ProviderSelectWindow {
  visibleEntries: ProviderSelectEntry[];
  placeholderOverride: string | undefined;
  advanceEntry: ProviderSelectEntry | null;
}

// Deliberate paging (storedStart) outranks expandedStartIndex because the expansion offset only prevents a newly
// expanded provider from falling off screen.
export function resolveProviderEntryStart(storedStart: number, expandedStartIndex: number): number {
  return storedStart || expandedStartIndex;
}

// Callers expanding a provider must repaint with a receipt because Discord closes the select after a choice, making
// rewritten options look like a no-op.
export function buildProviderSelectWindow(input: ProviderSelectWindowInput): ProviderSelectWindow {
  const overflows = input.entries.length > input.directLimit;
  const windowSize = overflows ? input.directLimit - 1 : input.directLimit;
  const rangeCount = Math.max(1, Math.ceil(input.entries.length / windowSize));
  const rangeIndex = Math.min(Math.max(0, Math.floor(input.entryStart / windowSize)), rangeCount - 1);
  const visibleEntries = input.entries.slice(rangeIndex * windowSize, rangeIndex * windowSize + windowSize);

  let advanceEntry: ProviderSelectEntry | null = null;
  if (overflows) {
    // Wrapping past the last window is what keeps every entry reachable from any window without a
    // second control: advancing repeatedly always returns to the first.
    const nextRangeIndex = (rangeIndex + 1) % rangeCount;
    advanceEntry = {
      value: input.encodeAdvanceValue(nextRangeIndex * windowSize, input.expandedProvider),
      label: localizer(input.locale, "commands.config.panel.model_provider_more_option", {
        capability: input.capabilityLabel,
        page: nextRangeIndex + 1,
        total: rangeCount,
      }),
    };
  }

  // While expanded the active model is the least useful thing the placeholder could say: the
  // reader has already chosen a provider and is looking for its pages.
  const placeholderOverride =
    input.expandedPageCount > 0 && input.expandedProvider
      ? localizer(input.locale, input.pagePlaceholderKey, {
          capability: input.capabilityLabel,
          provider: getProviderDisplayName(input.expandedProvider, input.locale),
        })
      : undefined;

  return { visibleEntries, placeholderOverride, advanceEntry };
}
