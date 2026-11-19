import type { AutocompleteInteraction, SlashCommandStringOption } from "discord.js";
import type { PanelReceipt } from "@/types/discord/panel";
import { safeSelectOptionText } from "@/utils/discord/ui/interactionCore";
import { localizer } from "@/utils/text/localizer";

export const PANEL_PAGE_OPTION_NAME = "page";

// Capped at 25 because Discord rejects autocomplete responses carrying more than 25 choices.
const MAX_PAGE_CHOICES = 25;

// Entries must be pre-filtered to what the invoker may open, using null page fields when a category has no pages so
// the category acts as the destination.
export interface PanelPageDestination<Category extends string = string, Page extends string | null = string | null> {
  category: Category;
  page: Page;
  categoryLabel: string;
  pageLabel: Page extends string ? string : null;
}

// Must stay optional: Discord runs a bare root only while it has no subcommand or required option.
export function configurePanelPageOption(
  option: SlashCommandStringOption,
  description: string,
): SlashCommandStringOption {
  return option.setName(PANEL_PAGE_OPTION_NAME).setDescription(description).setAutocomplete(true);
}

function destinationValue(destination: PanelPageDestination): string {
  return destination.page === null ? destination.category : `${destination.category}:${destination.page}`;
}

function destinationLabel(destination: PanelPageDestination): string {
  return destination.pageLabel === null
    ? destination.categoryLabel
    : `${destination.categoryLabel} > ${destination.pageLabel}`;
}

function startsAnyWord(text: string, prefix: string): boolean {
  return text.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(prefix));
}

// Stable category and page IDs stay in the haystack alongside labels so users can type English page IDs in any
// locale.
function matchTier(destination: PanelPageDestination, query: string, tokens: readonly string[]): number | null {
  const categoryLabel = destination.categoryLabel.toLowerCase();
  const primaryLabel = destination.pageLabel?.toLowerCase() ?? categoryLabel;
  const haystack = `${categoryLabel} ${primaryLabel} ${destination.category} ${destination.page ?? ""}`;
  if (!tokens.every((token) => haystack.includes(token))) return null;
  const [first = ""] = tokens;
  if (primaryLabel === query || destinationLabel(destination).toLowerCase() === query) return 0;
  if (primaryLabel.startsWith(query)) return 1;
  if (startsAnyWord(primaryLabel, first)) return 2;
  if (categoryLabel.startsWith(first)) return 3;
  return 4;
}

function rankPanelPages<T extends PanelPageDestination>(destinations: readonly T[], typed: string): T[] {
  const query = typed.trim().toLowerCase();
  const tokens = query.split(/[\s>›]+/).filter(Boolean);
  if (tokens.length === 0) return [...destinations];

  return destinations
    .map((destination, index) => ({ destination, index, tier: matchTier(destination, query, tokens) }))
    .filter((entry): entry is { destination: T; index: number; tier: number } => entry.tier !== null)
    .sort((left, right) => left.tier - right.tier || left.index - right.index)
    .map((entry) => entry.destination);
}

export async function respondWithPanelPages(
  interaction: AutocompleteInteraction,
  destinations: readonly PanelPageDestination[],
): Promise<void> {
  const choices = rankPanelPages(destinations, interaction.options.getFocused())
    .slice(0, MAX_PAGE_CHOICES)
    .map((destination) => ({
      name: safeSelectOptionText(destinationLabel(destination), 100),
      value: destinationValue(destination),
    }));
  await interaction.respond(choices);
}

// Raw typed input resolves only against `destinations` because Discord submits unpicked text, keeping the invoker's
// permission filter authoritative.
export function resolvePanelPage<T extends PanelPageDestination>(
  destinations: readonly T[],
  submitted: string,
): T | null {
  return (
    destinations.find((destination) => destinationValue(destination) === submitted) ??
    rankPanelPages(destinations, submitted)[0] ??
    null
  );
}

// Info tone rather than warning because a mistyped page name is not a panel failure worth recording as a metric.
export function panelPageNotFoundReceipt(locale: string): PanelReceipt {
  return {
    tone: "info",
    heading: localizer(locale, "general.panel_notice.not_available_heading"),
    detail: localizer(locale, "general.panel_notice.page_not_found_detail"),
  };
}

export function panelPersonaNotFoundReceipt(locale: string): PanelReceipt {
  return {
    tone: "info",
    heading: localizer(locale, "general.panel_notice.not_available_heading"),
    detail: localizer(locale, "general.panel_notice.persona_not_found_detail"),
  };
}
