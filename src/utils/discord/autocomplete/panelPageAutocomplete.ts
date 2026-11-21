import type { AutocompleteInteraction, SlashCommandStringOption } from "discord.js";
import type { PanelReceipt } from "@/types/discord/panel";
import { safeSelectOptionText } from "@/utils/discord/ui/interactionCore";
import { localizer } from "@/utils/text/localizer";

export const PANEL_PAGE_OPTION_NAME = "page";

/** Discord rejects an autocomplete response carrying more than 25 choices. */
const MAX_PAGE_CHOICES = 25;

/**
 * A page a panel command can open on directly, already filtered to what the invoker may open. A panel
 * whose categories have no pages uses a null `page` and `pageLabel`, so the category is the destination.
 */
export interface PanelPageDestination<Category extends string = string, Page extends string | null = string | null> {
  category: Category;
  page: Page;
  categoryLabel: string;
  pageLabel: Page extends string ? string : null;
}

/** Never required: Discord runs a bare root only while it has no subcommand or required option. */
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

/**
 * Lower tiers sort first: an exact label, then page name prefix, then a word of the page name, then the
 * category name, then any substring. Matching the stable IDs too lets a user type an English page ID in
 * any locale.
 */
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

/** Answers the focused `page` option with the destinations matching what the user has typed. */
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

/**
 * Discord submits whatever was typed when the user does not pick a suggestion, so text that is not a
 * suggestion value resolves to its best label match. Only `destinations` can be returned, which keeps
 * the invoker's permission filter authoritative over a hand-typed value.
 */
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

/** `info` rather than `warning`, because a mistyped page name is not a panel failure worth a metric. */
export function panelPageNotFoundReceipt(locale: string): PanelReceipt {
  return {
    tone: "info",
    heading: localizer(locale, "general.panel_notice.not_available_heading"),
    detail: localizer(locale, "general.panel_notice.page_not_found_detail"),
  };
}

/** `info` for the same reason as the page notice: a persona name typed without picking is not a failure. */
export function panelPersonaNotFoundReceipt(locale: string): PanelReceipt {
  return {
    tone: "info",
    heading: localizer(locale, "general.panel_notice.not_available_heading"),
    detail: localizer(locale, "general.panel_notice.persona_not_found_detail"),
  };
}
