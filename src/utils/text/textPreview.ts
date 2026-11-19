import {
  FENCE_GUARD,
  getDiscordTextLength,
  neutralizeFenceRuns,
  truncateDiscordText,
} from "@/utils/text/discordTextLimits";
import { formatLocaleInteger, localizer } from "@/utils/text/localizer";

// Discord caps Components V2 messages at 4000 characters across TextDisplay components, so 3000 leaves 1000
// characters of headroom for framing.
export const CV2_TEXT_PREVIEW_BUDGET = 3000;
// Deliberately smaller than removal budgets because the user still has their submitted text and only needs a glance
// to confirm the write.
export const CONFIRMATION_PREVIEW_BUDGET = 200;

export interface TextPreview {
  text: string;
  truncated: boolean;
  // Original pre-guard codepoint count (excluding zero-width fence guards) so shown totals match what the user
  // actually wrote.
  shownChars: number;
  totalChars: number;
}

// Fence guards run before truncation because escaping N backticks expands to 2N-1 codepoints and would otherwise
// exceed Discord's cap.
export function buildTextPreview(
  text: string | null | undefined,
  budget: number = CV2_TEXT_PREVIEW_BUDGET,
): TextPreview {
  const source = text?.trim() ?? "";
  const totalChars = getDiscordTextLength(source);
  if (totalChars === 0) {
    return { text: "", truncated: false, shownChars: 0, totalChars: 0 };
  }

  // Guard the fence first so the guard's expansion counts against the budget instead of being
  // appended past it. A guarded run never contains two adjacent backticks, so slicing it can at
  // worst leave a single trailing backtick, which cannot re-open a fence.
  const guardedFull = neutralizeFenceRuns(source);
  const truncated = getDiscordTextLength(guardedFull) > budget;
  const guarded = truncated ? truncateDiscordText(guardedFull, budget, "") : guardedFull;

  // Report shownChars in original terms by dropping the zero-width guards,
  //    so "Showing the first X of Y" stays honest even after fence expansion.
  return {
    text: guarded,
    truncated,
    shownChars: getDiscordTextLength(guarded.split(FENCE_GUARD).join("")),
    totalChars,
  };
}

export function textPreviewFooterKey(preview: TextPreview): string | undefined {
  return preview.truncated ? "general.text_preview.truncated_footer" : undefined;
}

export function textPreviewFooterVars(preview: TextPreview, locale: string): Record<string, string> {
  return {
    shown: formatLocaleInteger(preview.shownChars, locale),
    total: formatLocaleInteger(preview.totalChars, locale),
  };
}

// Capped at 500 chars (fence and marker included) because every previewed value has an edit modal for the full text,
// so panels only need recognition.
export const FENCED_PREVIEW_MAX_CHARS = 500;

export interface FencedPreviewOptions {
  budget?: number;
  actionLabel?: string;
}

const fenceMarkdown = (body: string): string => ["```markdown", body, "```"].join("\n");

// Fenced output drops to empty if budget cannot fit the HTML comment marker (which Discord styles distinctly) because
// slicing a fence leaks into the message.
export function renderFencedPreview(
  locale: string,
  text: string,
  { budget = FENCED_PREVIEW_MAX_CHARS, actionLabel }: FencedPreviewOptions = {},
): string {
  const limit = Math.min(budget, FENCED_PREVIEW_MAX_CHARS);
  const guarded = neutralizeFenceRuns(text);
  const full = fenceMarkdown(guarded);
  if (getDiscordTextLength(full) <= limit) return full;

  const totalChars = getDiscordTextLength(text);
  const marker = (hidden: number): string =>
    `<!-- ${localizer(
      locale,
      actionLabel ? "general.text_preview.hidden_marker_action" : "general.text_preview.hidden_marker",
      { count: formatLocaleInteger(hidden, locale), action: actionLabel ?? "" },
    )} -->`;
  // Sizing with the total count reserves the longest marker this text can need, so the marker
  // built from the real hidden count always fits.
  const available = limit - getDiscordTextLength(fenceMarkdown(`\n${marker(totalChars)}`));
  if (available < 0) return "";
  const shown = truncateDiscordText(guarded, available, "").trimEnd();
  const hidden = totalChars - getDiscordTextLength(shown.split(FENCE_GUARD).join(""));
  return fenceMarkdown(shown ? `${shown}\n${marker(hidden)}` : marker(hidden));
}
