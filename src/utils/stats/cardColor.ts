/**
 * cardColor.ts: shared color + image helpers for the `/stats generate`
 * infographic gatherers.
 *
 * This module is part of the GATHER layer (it uses `sharp` and reads asset
 * files). Renderers in `statsInfographic.tsx` stay pure and never import this.
 *
 * It centralises:
 * - RGB/HSL math used to derive accessible light-mode palettes.
 * - `extractCardPalette`: samples the selected avatar/icon into a palette for
 *   Personal Wrapped, Persona Affinity, or the Server Leaderboard.
 * - `extractAvatarAccentColor`: distils a single vivid bar-fill color from an
 *   avatar, used to tint each persona/member bar on the Server Leaderboard.
 * - `loadTomoriconDataUri`: shared monochrome-stamp tinting used by every card.
 */
import { resolve } from "node:path";
import sharp from "sharp";
import { log } from "@/utils/misc/logger";
import { DEFAULT_PERSONAL_CARD_PALETTE, type PersonalCardPalette } from "@/utils/stats/statsInfographic";

const TOMORICON_MONO_DARK_PATH = resolve("assets/img/tomoricon-mono-dark.png");
const tomoriconDataUriByColor = new Map<string, string | null>();

function parseHexColor(color: string): { red: number; green: number; blue: number } {
  const raw = color.trim().replace(/^#/, "");
  const hex =
    raw.length === 3
      ? raw
          .split("")
          .map((channel) => `${channel}${channel}`)
          .join("")
      : raw;
  if (!/^[\da-f]{6}$/i.test(hex)) {
    throw new Error(`Expected a six-digit hex color, received "${color}"`);
  }
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  };
}

/**
 * Returns the monochrome Tomoricon stamp tinted to `color`, as a PNG data URI.
 * Results are memoized per color so repeated card renders re-use the buffer.
 *
 * @param color - Hex tint applied to the stamp (usually `palette.ink`).
 * @returns A `data:image/png;base64,...` URI, or null if the asset can't load.
 */
export async function loadTomoriconDataUri(color: string): Promise<string | null> {
  const cached = tomoriconDataUriByColor.get(color);
  if (cached !== undefined) return cached;
  try {
    const { red, green, blue } = parseHexColor(color);
    const { data, info } = await sharp(TOMORICON_MONO_DARK_PATH)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const tintedPixels = Buffer.alloc(data.length);
    for (let index = 0; index < data.length; index += info.channels) {
      tintedPixels[index] = red;
      tintedPixels[index + 1] = green;
      tintedPixels[index + 2] = blue;
      tintedPixels[index + 3] = data[index + 3];
    }
    const tintedIcon = await sharp(tintedPixels, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    })
      .png()
      .toBuffer();
    const dataUri = `data:image/png;base64,${tintedIcon.toString("base64")}`;
    tomoriconDataUriByColor.set(color, dataUri);
    return dataUri;
  } catch (error) {
    tomoriconDataUriByColor.set(color, null);
    log.warn("cardColor: Tomoricon stamp could not be loaded", error as Error);
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

/** One quantized, saturated color bucket sampled from an image, with HSL fields. */
interface ColorBucket {
  red: number;
  green: number;
  blue: number;
  count: number;
  hue: number;
  saturation: number;
  lightness: number;
}

/**
 * Samples a base64 image data URI down to 64×64 and returns its saturated,
 * non-extreme color buckets (alpha-filtered, quantized to 32-step channels).
 * Shared by both palette and single-accent extraction so they sample identically.
 *
 * @param avatarDataUri - A `data:...;base64,...` image URI, or null.
 * @returns Ranked-agnostic buckets, or null when the image yields no usable color.
 */
async function sampleColorBuckets(avatarDataUri: string | null): Promise<ColorBucket[] | null> {
  if (!avatarDataUri) return null;
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

  if (buckets.size === 0) return null;
  return [...buckets.values()].map((bucket) => ({ ...bucket, ...rgbToHsl(bucket.red, bucket.green, bucket.blue) }));
}

/**
 * Samples a hero image into an accessible, light-mode card palette with two
 * roles: a base hue (pale surfaces + dark ink) and a distinct saturated accent.
 * Falls back to the neutral default palette if the image is missing/undecodable.
 *
 * @param avatarDataUri - Persona avatar (Personal or Persona Affinity) or server icon URI.
 */
export async function extractCardPalette(avatarDataUri: string | null): Promise<PersonalCardPalette> {
  if (!avatarDataUri) return DEFAULT_PERSONAL_CARD_PALETTE;

  try {
    const colorBuckets = await sampleColorBuckets(avatarDataUri);
    if (!colorBuckets) return DEFAULT_PERSONAL_CARD_PALETTE;

    const dominant = [...colorBuckets].sort((left, right) => right.count - left.count)[0];
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
    log.warn("cardColor: card palette extraction failed", error as Error);
    return DEFAULT_PERSONAL_CARD_PALETTE;
  }
}

/**
 * Distils a single vivid bar-fill color from an avatar: the dominant saturated
 * hue, normalised to a mid lightness so white or dark in-bar text stays legible.
 * Returns `fallback` when the avatar is missing or has no usable saturated color.
 *
 * @param avatarDataUri - The avatar image data URI, or null.
 * @param fallback - Hex color to use when no accent can be derived.
 */
export async function extractAvatarAccentColor(avatarDataUri: string | null, fallback: string): Promise<string> {
  if (!avatarDataUri) return fallback;
  try {
    const colorBuckets = await sampleColorBuckets(avatarDataUri);
    if (!colorBuckets) return fallback;
    const dominant = [...colorBuckets].sort((left, right) => right.count - left.count)[0];
    if (!dominant) return fallback;
    return hslToHex(dominant.hue, clamp(Math.round(dominant.saturation * 100), 50, 84), 48);
  } catch (error) {
    log.warn("cardColor: avatar accent extraction failed", error as Error);
    return fallback;
  }
}
