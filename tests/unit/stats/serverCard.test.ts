/** Unit tests for the portrait Server Leaderboard infographic. */
import { beforeAll, describe, expect, it } from "bun:test";
import { renderCardToPng } from "@/utils/stats/cardRenderer";
import type { ServerCardData } from "@/utils/stats/statsInfographic";
import { CARD_W, getServerCardHeight, renderServerCard } from "@/utils/stats/statsInfographic";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => {
  await initializeLocalizer();
});

const SAMPLE_EN: ServerCardData = {
  locale: "en-US",
  timeframe: "all_time",
  serverName: "Tomori Dev Server",
  serverIconDataUri: null,
  topPersonas: [
    { name: "Tomori", avatarDataUri: null, rank: 1, inputTokens: 31_386, outputTokens: 4_820, sharePct: 62.4 },
    { name: "Lilya", avatarDataUri: null, rank: 2, inputTokens: 12_402, outputTokens: 1_204, sharePct: 18.2 },
  ],
  topHumans: [
    { name: "alice", avatarDataUri: null, rank: 1, triggers: 3_421, estimatedCost: 1.27 },
    { name: "bob", avatarDataUri: null, rank: 2, triggers: 2_108, estimatedCost: 0.88 },
  ],
  topModelName: "gemini-1.5-pro",
  inputTokens: 84_210,
  outputTokens: 12_408,
  estimatedCost: 4.27,
  totalTriggers: 8_230,
  topPersonaEmojis: [{ name: "happy", imageDataUri: null }],
};

const SAMPLE_JA: ServerCardData = {
  ...SAMPLE_EN,
  locale: "ja",
  serverName: "友里のサーバー",
  topPersonas: [
    { name: "友里", avatarDataUri: null, rank: 1, inputTokens: 31_386, outputTokens: 4_820, sharePct: 62.4 },
  ],
  topHumans: [{ name: "さくら", avatarDataUri: null, rank: 1, triggers: 3_421, estimatedCost: 1.27 }],
};

describe("renderServerCard", () => {
  it("returns a VNode for English and Japanese data", () => {
    expect(renderServerCard(SAMPLE_EN)).toBeObject();
    expect(renderServerCard(SAMPLE_JA).type).toBe("div");
  });

  it("renders the no-data state when the server has no triggers", () => {
    expect(renderServerCard({ ...SAMPLE_EN, totalTriggers: 0, topPersonas: [], topHumans: [] })).toBeObject();
  });
});

describe("renderServerCard PNG", () => {
  it("produces non-empty English and Japanese PNGs", async () => {
    const english = await renderCardToPng(renderServerCard(SAMPLE_EN), CARD_W, getServerCardHeight(SAMPLE_EN));
    const japanese = await renderCardToPng(renderServerCard(SAMPLE_JA), CARD_W, getServerCardHeight(SAMPLE_JA));
    expect(english.byteLength).toBeGreaterThan(1000);
    expect(japanese.byteLength).toBeGreaterThan(1000);
  });

  it("adds height only for additional leaderboard rows", () => {
    expect(getServerCardHeight(SAMPLE_EN)).toBeGreaterThan(getServerCardHeight(SAMPLE_JA));
  });
}, 30_000);
