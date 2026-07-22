/**
 * Helpers for rendering user-authored text back to the user inside a Discord
 * notice — either at the moment it is deleted, or to confirm what was just
 * saved.
 *
 * Two problems recur across every command that does this:
 *
 * 1. **Fence breakout.** The text is interpolated into a locale string that
 *    already owns a code fence. Text containing its own triple backtick closes
 *    that fence early and mangles the rest of the card.
 * 2. **Dishonest truncation.** Callers slice to a fixed width and either bake a
 *    trailing ellipsis into the locale string unconditionally (claiming
 *    truncation that did not happen) or drop the cut silently.
 *
 * {@link buildTextPreview} solves both, and the shared footer helpers give
 * every call site the same honest "how much was hidden" line.
 *
 * Callers interpolate {@link TextPreview.text} into a locale string that owns
 * the code fence, matching the existing convention in
 * `commands.config.prompt.change.success_description`.
 */

/**
 * Character budget for a preview rendered inside a Components V2 workflow card.
 *
 * Discord caps a Components V2 message at 4000 characters across every
 * TextDisplay component, so this leaves roughly 1000 characters of headroom for
 * the title, description, footer, and any guard characters inserted by
 * {@link neutralizeCodeFences}.
 */
export const CV2_TEXT_PREVIEW_BUDGET = 3000;

/**
 * Character budget for a preview rendered inside a standard embed description,
 * which Discord caps at 4096 characters. Kept equal to the Components V2 budget
 * so the same text truncates identically no matter which surface shows it.
 */
export const EMBED_TEXT_PREVIEW_BUDGET = 3000;

/**
 * Character budget for "here is what you just saved" confirmations.
 *
 * Deliberately much smaller than the removal budgets: the user still has the
 * text they just submitted, so this is a glance to confirm the write landed,
 * not a recovery lifeline. Matches the width these call sites already used.
 */
export const CONFIRMATION_PREVIEW_BUDGET = 200;

/**
 * Zero-width space used to break up backtick runs. It renders as nothing but
 * stops the sequence from being parsed as a fence delimiter.
 */
const FENCE_GUARD = "​";

/** A fence-safe, budget-bounded rendering of user-authored text. */
export interface TextPreview {
  /** Fence-safe text, ready to interpolate into a locale string's code block. */
  text: string;
  /** Whether {@link text} was cut short to fit the budget. */
  truncated: boolean;
  /** Characters shown, counted against the original (pre-guard) text. */
  shownChars: number;
  /** Total characters in the original text. */
  totalChars: number;
}

/**
 * Breaks up runs of two or more backticks so user content cannot escape the
 * code fence it is rendered inside.
 *
 * Two backticks delimit inline code and three delimit a block, so any run of
 * two or more is a potential breakout. Interleaving a zero-width space leaves
 * the text visually unchanged while making the run inert.
 *
 * @param text - Raw user-authored text.
 * @returns The same text with every backtick run neutralized.
 */
function neutralizeCodeFences(text: string): string {
  return text.replace(/`{2,}/g, (run) => run.split("").join(FENCE_GUARD));
}

/**
 * Builds a fence-safe preview of user-authored text.
 *
 * Truncation is measured against the original text so the reported counts match
 * what the user actually wrote; fence guards are applied afterwards and are
 * absorbed by the headroom baked into the budget constants.
 *
 * @param text - The text to preview; `null`/`undefined`/blank yields a preview with `totalChars === 0`.
 * @param budget - Maximum characters to show, defaulting to {@link CV2_TEXT_PREVIEW_BUDGET}.
 * @returns A {@link TextPreview} describing what to render.
 */
export function buildTextPreview(
  text: string | null | undefined,
  budget: number = CV2_TEXT_PREVIEW_BUDGET,
): TextPreview {
  // 1. Normalize away the empty cases so callers can branch on totalChars.
  const source = text?.trim() ?? "";
  if (source.length === 0) {
    return { text: "", truncated: false, shownChars: 0, totalChars: 0 };
  }

  // 2. Cut against the original text so shownChars/totalChars stay meaningful
  //    to the user, who has no idea guard characters exist.
  const totalChars = source.length;
  const truncated = totalChars > budget;
  const shown = truncated ? source.slice(0, budget) : source;

  // 3. Guard the fence only after measuring.
  return {
    text: neutralizeCodeFences(shown),
    truncated,
    shownChars: shown.length,
    totalChars,
  };
}

/**
 * Resolves the muted footer describing how much of a preview was cut, if any.
 *
 * @param preview - The preview returned by {@link buildTextPreview}.
 * @returns The shared truncation footer key, or `undefined` when nothing was cut.
 */
export function textPreviewFooterKey(preview: TextPreview): string | undefined {
  return preview.truncated ? "general.text_preview.truncated_footer" : undefined;
}

/**
 * Builds the interpolation vars for {@link textPreviewFooterKey}.
 *
 * @param preview - The preview returned by {@link buildTextPreview}.
 * @returns Localizer vars with thousands-separated counts.
 */
export function textPreviewFooterVars(preview: TextPreview): Record<string, string> {
  return {
    shown: preview.shownChars.toLocaleString("en-US"),
    total: preview.totalChars.toLocaleString("en-US"),
  };
}
