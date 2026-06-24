/**
 * personalCardGatherer.ts — data-gathering layer for the Personal "Wrapped"
 * infographic card (plans/stat-tracking.md §10, Phase 3).
 *
 * This is the ONLY file in the infographic stack that touches the DB.
 * `gatherPersonalCardData` calls the StatsRepository read methods and returns a
 * `PersonalCardData` struct that `renderPersonalCard` consumes as a pure function.
 *
 * Rules applied here (not in the renderer):
 * - AVATARS: user and favorite-persona references are resolved via
 *   `loadStoredPersonaAvatarDataUri` (handles both local dev paths and remote
 *   HTTP(S) URLs) and base64-encoded for the card's embedded `<img>` data URI.
 *   Fetch failure is graceful — returns null so the renderer shows a placeholder.
 * - PALETTE: the first favorite persona avatar is sampled into an accessible,
 *   light-mode card palette. A neutral fallback keeps cards readable if it is
 *   unavailable or cannot be decoded.
 */
import { resolve } from "node:path";
import sharp from "sharp";
import { statRepository } from "@/utils/db/repositories";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { log } from "@/utils/misc/logger";
import { loadStoredPersonaAvatarDataUri } from "@/utils/storage/avatarStorage";
import { type Timeframe, resolveWindowFrom } from "@/utils/stats/statsDashboard";
import { prettifyModelCodename } from "@/utils/provider/customProviderUtils";
import {
  DEFAULT_PERSONAL_CARD_PALETTE,
  PERSONAL_HERO_VARIANT_COUNT,
  type PersonalCardData,
  type PersonalHeroVariant,
  type PersonalCardPalette,
  type PersonalFavoritePersona,
} from "@/utils/stats/statsInfographic";

const TOMORICON_MONO_DARK_PATH = resolve("assets/img/tomoricon-mono-dark.png");
const tomoriconDataUriByColor = new Map<string, string | null>();

async function loadTomoriconDataUri(color: string): Promise<string | null> {
  const cached = tomoriconDataUriByColor.get(color);
  if (cached !== undefined) return cached;
  try {
    const tintedIcon = await sharp(TOMORICON_MONO_DARK_PATH).ensureAlpha().tint(color).png().toBuffer();
    const dataUri = `data:image/png;base64,${tintedIcon.toString("base64")}`;
    tomoriconDataUriByColor.set(color, dataUri);
    return dataUri;
  } catch (error) {
    tomoriconDataUriByColor.set(color, null);
    log.warn("personalCardGatherer: Tomoricon stamp could not be loaded", error as Error);
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rgbToHsl(red: number, green: number, blue: number): { hue: number; saturation: number; lightness: number } {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation, lightness };
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = l - chroma / 2;
  const [r, g, b] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const component = (value: number) =>
    Math.round((value + match) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${component(r)}${component(g)}${component(b)}`;
}

function hueDistance(first: number, second: number): number {
  const difference = Math.abs(first - second);
  return Math.min(difference, 360 - difference);
}

/** Decorative-only choice; generated here so the pure renderer stays deterministic for each card. */
function choosePersonalHeroVariant(): PersonalHeroVariant {
  return Math.floor(Math.random() * PERSONAL_HERO_VARIANT_COUNT) as PersonalHeroVariant;
}

/** Samples the leading persona avatar into a high-contrast light-mode palette. */
export async function extractPersonalCardPalette(avatarDataUri: string | null): Promise<PersonalCardPalette> {
  if (!avatarDataUri) return DEFAULT_PERSONAL_CARD_PALETTE;

  try {
    const payload = avatarDataUri.slice(avatarDataUri.indexOf(",") + 1);
    const imageBuffer = Buffer.from(payload, "base64");
    const { data, info } = await sharp(imageBuffer)
      .resize(64, 64, { fit: "cover" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const buckets = new Map<string, { red: number; green: number; blue: number; count: number }>();

    for (let index = 0; index < data.length; index += info.channels) {
      if (data[index + 3] < 200) continue;
      const red = Math.round(data[index] / 32) * 32;
      const green = Math.round(data[index + 1] / 32) * 32;
      const blue = Math.round(data[index + 2] / 32) * 32;
      const { saturation, lightness } = rgbToHsl(red, green, blue);
      if (saturation < 0.18 || lightness < 0.12 || lightness > 0.9) continue;
      const key = `${red}:${green}:${blue}`;
      const bucket = buckets.get(key) ?? { red, green, blue, count: 0 };
      bucket.count++;
      buckets.set(key, bucket);
    }

    const colorBuckets = [...buckets.values()].map((bucket) => ({
      ...bucket,
      ...rgbToHsl(bucket.red, bucket.green, bucket.blue),
    }));
    const dominant = colorBuckets.sort((left, right) => right.count - left.count)[0];
    if (!dominant) return DEFAULT_PERSONAL_CARD_PALETTE;
    const contrastingAccent =
      colorBuckets
        .filter(
          (bucket) =>
            bucket.saturation >= 0.4 &&
            bucket.lightness >= 0.18 &&
            bucket.lightness <= 0.82 &&
            hueDistance(bucket.hue, dominant.hue) >= 34,
        )
        .sort(
          (left, right) =>
            Math.sqrt(right.count) * (0.5 + right.saturation) * (1 - Math.abs(right.lightness - 0.52)) -
            Math.sqrt(left.count) * (0.5 + left.saturation) * (1 - Math.abs(left.lightness - 0.52)),
        )[0] ?? dominant;
    const baseSaturation = clamp(Math.round(dominant.saturation * 100), 36, 72);
    const accentSaturation = clamp(Math.round(contrastingAccent.saturation * 100), 52, 84);
    return {
      background: hslToHex(dominant.hue, Math.min(baseSaturation, 32), 97),
      surface: hslToHex(dominant.hue, Math.min(baseSaturation, 46), 90),
      ink: hslToHex(dominant.hue, Math.min(baseSaturation, 38), 16),
      muted: hslToHex(dominant.hue, Math.min(baseSaturation, 30), 34),
      accent: hslToHex(contrastingAccent.hue, accentSaturation, 40),
      accentSecondary: hslToHex(dominant.hue, baseSaturation, 38),
      border: hslToHex(dominant.hue, Math.min(baseSaturation, 36), 76),
    };
  } catch (error) {
    log.warn("personalCardGatherer: favorite persona palette extraction failed", error as Error);
    return DEFAULT_PERSONAL_CARD_PALETTE;
  }
}

// ── Main gather function ───────────────────────────────────────────────────────

/** Arguments for `gatherPersonalCardData`. */
export interface GatherPersonalCardArgs {
  /** Internal `users` FK (not the Discord snowflake). */
  userId: number;
  /** Internal `servers` FK — passed for "this server" scope; omit for global. */
  serverId?: number;
  /** Discord guild snowflake ID, used to resolve persona names/avatars from cache. */
  guildDiscId: string;
  /** Display name shown on the card. */
  username: string;
  /** Discord CDN URL for the invoking user's avatar. */
  userAvatarUrl?: string | null;
  /** BCP-47 locale passed through to `PersonalCardData`. */
  locale: string;
  /** Selected time window — drives gating and window floor. */
  timeframe: Timeframe;
}

export async function gatherPersonalCardData(args: GatherPersonalCardArgs): Promise<PersonalCardData> {
  const { userId, serverId, guildDiscId, username, userAvatarUrl, locale, timeframe } = args;
  const windowFrom = resolveWindowFrom(timeframe);
  const windowArg = windowFrom ? { from: windowFrom } : {};

  const [personaAffinity, totalTriggers, tokenTotals, estimatedCost, personaTokenCosts, modelBreakdown] =
    await Promise.all([
      statRepository.getPersonaAffinity({ userId, serverId, ...windowArg }),
      statRepository.getMetricTotal({ metric: "message_sent", userId, serverId, ...windowArg }),
      statRepository.getTokenTotals({ userId, serverId, ...windowArg }),
      statRepository.getEstimatedCost({ userId, serverId, ...windowArg }),
      statRepository.getPersonaTokenCostBreakdown({ userId, serverId, ...windowArg }),
      statRepository.getModelBreakdown({ userId, serverId, ...windowArg }),
    ]);

  const tokenCostByLineage = new Map(personaTokenCosts.map((entry) => [entry.lineageId, entry]));
  let favoritePersonas: PersonalFavoritePersona[] = [];
  try {
    const personas = await getCachedAllPersonas(guildDiscId);
    favoritePersonas = await Promise.all(
      personaAffinity.slice(0, 5).map(async (entry) => {
        const persona = personas.find((candidate) => candidate.persona_lineage_id === entry.lineageId);
        const avatarDataUri = persona?.webhook_avatar_url
          ? await loadStoredPersonaAvatarDataUri(persona.webhook_avatar_url)
          : null;
        const tokenCost = tokenCostByLineage.get(entry.lineageId);
        return {
          name: persona?.persona_nickname ?? `Persona #${entry.lineageId}`,
          avatarDataUri,
          totalTokens: (tokenCost?.inputTokens ?? 0) + (tokenCost?.outputTokens ?? 0),
          estimatedCost: tokenCost?.cost ?? 0,
        };
      }),
    );
  } catch (error) {
    log.warn("personalCardGatherer: persona resolution failed", error as Error);
  }

  let userAvatarDataUri: string | null = null;
  if (userAvatarUrl) {
    try {
      userAvatarDataUri = await loadStoredPersonaAvatarDataUri(userAvatarUrl);
    } catch (error) {
      log.warn("personalCardGatherer: user avatar resolution failed", error as Error);
    }
  }

  const leadingAvatarDataUri = favoritePersonas[0]?.avatarDataUri ?? null;
  const palette = await extractPersonalCardPalette(leadingAvatarDataUri);
  const heroVariant = choosePersonalHeroVariant();
  // TEMPORARY: emitted at the always-visible metric level so production card
  // generation can confirm whether the leading avatar supplied the palette.
  log.metric("stats.personal_card_palette", {
    palette_source: palette === DEFAULT_PERSONAL_CARD_PALETTE ? "fallback" : "leading_avatar",
    leading_avatar_loaded: leadingAvatarDataUri ? "true" : "false",
    palette_accent: palette.accent,
    palette_accent_secondary: palette.accentSecondary,
    palette_background: palette.background,
    palette_ink: palette.ink,
    hero_variant: heroVariant,
  });
  return {
    locale,
    timeframe,
    username,
    userAvatarDataUri,
    tomoriconDataUri: await loadTomoriconDataUri(palette.ink),
    palette,
    totalTokens: tokenTotals.inputTokens + tokenTotals.outputTokens,
    totalTriggers,
    estimatedCost,
    favoritePersonas,
    favoriteModelName: modelBreakdown[0] ? prettifyModelCodename(modelBreakdown[0].model) : null,
    heroVariant,
  };
}
