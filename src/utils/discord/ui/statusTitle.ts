import type { ColorResolvable } from "discord.js";
import { resolveAccentColor, type AccentColorInput } from "@/utils/discord/ui/panel";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

// Status circles belong to the surface color, not locale strings, so helpers strip any existing circle before
// prepending to prevent contradictory or double markers.

export type StatusTone = "error" | "warning" | "success";

const STATUS_CIRCLE_BY_TONE: Record<StatusTone, string> = {
  error: "🔴",
  warning: "🟡",
  success: "🟢",
};

// Note severity stays independent of surface color, because a single panel lists notes of different severities
// together.
export function statusNote(tone: StatusTone, text: string): string {
  return `${STATUS_CIRCLE_BY_TONE[tone]} ${text}`;
}

// RATE_LIMIT and other ColorCode entries are omitted deliberately because no status title renders on them.
const STATUS_TONE_BY_COLOR = new Map<number, StatusTone>([
  [resolveAccentColor(ColorCode.ERROR), "error"],
  [resolveAccentColor(ColorCode.WARN), "warning"],
  [resolveAccentColor(ColorCode.SUCCESS), "success"],
]);

// Optional U+FE0F and whitespace strip trailing variation selectors because some authored circle emoji carry them.
const LEADING_STATUS_CIRCLE = new RegExp(
  `^(?:${Object.values(STATUS_CIRCLE_BY_TONE).join("|")})\\uFE0F?[\\s\\u00A0]*`,
  "u",
);

// Titles starting with an emoji stay bare because prepending a status circle would render two markers side by side.
const LEADING_EMOJI = /^\p{Extended_Pictographic}/u;

export function stripStatusCircle(title: string): string {
  return title.replace(LEADING_STATUS_CIRCLE, "");
}

export function resolveStatusTone(color?: ColorResolvable | null): StatusTone | null {
  if (color === undefined || color === null) return null;
  // ColorResolvable is a superset of AccentColorInput; resolveAccentColor falls back to info for
  // shapes it cannot parse, so an unmappable color simply yields no tone.
  return STATUS_TONE_BY_COLOR.get(resolveAccentColor(color as AccentColorInput)) ?? null;
}

export function withStatusCircle(title: string, color?: ColorResolvable | null): string {
  const bare = stripStatusCircle(title).trim();
  const tone = resolveStatusTone(color);
  if (!tone || bare.length === 0 || LEADING_EMOJI.test(bare)) return bare;
  return `${STATUS_CIRCLE_BY_TONE[tone]} ${bare}`;
}

// Full multi-code-point emoji runs are stripped together, because stranding a variation selector or joiner makes
// Discord render a blank box.
const LEADING_EMOJI_RUN = /^(?:\p{Extended_Pictographic}(?:️|‍|\p{Emoji_Modifier})*)+[\s ]*/u;

export function stripLeadingEmoji(title: string): string {
  return title.replace(LEADING_EMOJI_RUN, "");
}

export function localizedStatusTitle(
  locale: string,
  titleKey: string,
  color?: ColorResolvable | null,
  titleVars?: Record<string, string | number | boolean>,
): string {
  return withStatusCircle(localizer(locale, titleKey, titleVars), color);
}
