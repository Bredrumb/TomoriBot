/** Unit tests for the 9:16 Personal Wrapped infographic. */
import { beforeAll, describe, expect, it } from "bun:test";
import sharp from "sharp";
import { renderCardToPng } from "@/utils/stats/cardRenderer";
import { loadTomoriconDataUri } from "@/utils/stats/cardColor";
import { extractPersonalCardPalette } from "@/utils/stats/personalCardGatherer";
import type { PersonalCardData } from "@/utils/stats/statsInfographic";
import {
  CARD_W,
  DEFAULT_PERSONAL_CARD_PALETTE,
  getPersonalCardHeight,
  renderPersonalCard,
} from "@/utils/stats/statsInfographic";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => {
  await initializeLocalizer();
});

const SAMPLE_EN: PersonalCardData = {
  locale: "en-US",
  timeframe: "all_time",
  username: "alice",
  userAvatarDataUri: null,
  tomoriconDataUri: null,
  palette: DEFAULT_PERSONAL_CARD_PALETTE,
  totalTokens: 56_951,
  totalTriggers: 1_234,
  estimatedCost: 0.0042,
  favoritePersonas: [
    { name: "Tomori", avatarDataUri: null, totalTokens: 42_100, estimatedCost: 0.0031 },
    { name: "Lilya", avatarDataUri: null, totalTokens: 14_851, estimatedCost: 0.0011 },
  ],
  favoriteModelName: "gemini-1.5-pro",
};

const SAMPLE_JA: PersonalCardData = {
  ...SAMPLE_EN,
  locale: "ja",
  username: "さくら",
  favoritePersonas: [{ name: "友里", avatarDataUri: null, totalTokens: 56_951, estimatedCost: 0.0042 }],
};

describe("renderPersonalCard", () => {
  it("returns a VNode for English and Japanese data", () => {
    expect(renderPersonalCard(SAMPLE_EN)).toBeObject();
    expect(renderPersonalCard(SAMPLE_JA).type).toBe("div");
  });

  it("renders the no-data state when no triggers exist", () => {
    expect(renderPersonalCard({ ...SAMPLE_EN, totalTriggers: 0, favoritePersonas: [] })).toBeObject();
  });
});

describe("extractPersonalCardPalette", () => {
  it("derives a contrasting accent instead of only the avatar's dominant hue", async () => {
    const pixels = Buffer.alloc(16 * 16 * 4);
    for (let pixel = 0; pixel < 16 * 16; pixel++) {
      const offset = pixel * 4;
      const isAccent = pixel % 16 >= 12;
      pixels[offset] = isAccent ? 220 : 24;
      pixels[offset + 1] = isAccent ? 28 : 82;
      pixels[offset + 2] = isAccent ? 84 : 138;
      pixels[offset + 3] = 255;
    }
    const image = await sharp(pixels, { raw: { width: 16, height: 16, channels: 4 } })
      .png()
      .toBuffer();
    const palette = await extractPersonalCardPalette(`data:image/png;base64,${image.toString("base64")}`);
    const accentRedChannel = Number.parseInt(palette.accent.slice(1, 3), 16);
    const accentBlueChannel = Number.parseInt(palette.accent.slice(5, 7), 16);

    expect(palette).not.toEqual(DEFAULT_PERSONAL_CARD_PALETTE);
    expect(palette.background).toStartWith("#");
    expect(palette.accent).toStartWith("#");
    expect(accentRedChannel).toBeGreaterThan(accentBlueChannel);
  });
});

describe("loadTomoriconDataUri", () => {
  it("uses the requested color for opaque stamp pixels", async () => {
    const tinted = await loadTomoriconDataUri("#2f6259");
    expect(tinted).not.toBeNull();
    if (!tinted) throw new Error("Tinted Tomoricon was unavailable");

    const encoded = tinted.slice(tinted.indexOf(",") + 1);
    const { data, info } = await sharp(Buffer.from(encoded, "base64"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const opaqueOffset = Array.from({ length: data.length / info.channels }, (_, pixel) => pixel * info.channels).find(
      (offset) => data[offset + 3] === 255,
    );

    expect(opaqueOffset).toBeDefined();
    if (opaqueOffset === undefined) throw new Error("Tinted Tomoricon had no opaque pixels");
    expect([...data.subarray(opaqueOffset, opaqueOffset + 3)]).toEqual([47, 98, 89]);
  });
});

describe("renderPersonalCard PNG", () => {
  it("renders a 9:16 PNG with the expected dimensions", async () => {
    const height = getPersonalCardHeight(SAMPLE_EN);
    const png = await renderCardToPng(renderPersonalCard(SAMPLE_EN), CARD_W, height);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.byteLength).toBeGreaterThan(1000);
    expect(png.readUInt32BE(16)).toBe(CARD_W);
    expect(png.readUInt32BE(20)).toBe(height);
    expect(height / CARD_W).toBeCloseTo(16 / 9, 5);
  });

  it("renders Japanese glyphs into a non-empty PNG", async () => {
    const png = await renderCardToPng(renderPersonalCard(SAMPLE_JA), CARD_W, getPersonalCardHeight(SAMPLE_JA));
    expect(png.byteLength).toBeGreaterThan(1000);
  });
});
