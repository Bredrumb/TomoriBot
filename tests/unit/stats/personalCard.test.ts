/**
 * Unit tests for Phase 3 Chunk 2 — Personal "Wrapped" infographic card.
 *
 * Covers (all DB-free, injecting data directly):
 * 1. countWeekdayOccurrences — correct weekday counts in a window.
 * 2. normalizeHeatmap — division by occurrence count; midnight-crossing window;
 *    all-time fallback (no windowFrom, anniversary used).
 * 3. Timeframe gating predicates — which sections appear under each timeframe.
 * 4. renderPersonalCard — pure VNode smoke test (no DB, no satori).
 * 5. renderCardToPng — PNG raster smoke test (requires font files).
 */
import { describe, expect, it } from "bun:test";
import {
  countWeekdayOccurrences,
  normalizeHeatmap,
  shouldShowConditioning,
  shouldShowHeatmap,
  shouldShowStreak,
} from "@/utils/stats/personalCardGatherer";
import type { PersonalCardData } from "@/utils/stats/statsInfographic";
import { renderPersonalCard } from "@/utils/stats/statsInfographic";
import { renderCardToPng } from "@/utils/stats/cardRenderer";
import type { ActivityHeatmap } from "@/utils/db/repositories/StatRepository";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a zeroed 7×24 ActivityHeatmap, then apply patches from the record. */
function makeGrid(patches: Partial<Record<number, Partial<Record<number, number>>>>): ActivityHeatmap {
  const grid: ActivityHeatmap = {};
  for (let d = 0; d < 7; d++) {
    grid[d] = {};
    for (let h = 0; h < 24; h++) grid[d][h] = 0;
  }
  for (const [d, hours] of Object.entries(patches)) {
    for (const [h, v] of Object.entries(hours as Record<number, number>)) {
      grid[Number(d)][Number(h)] = v;
    }
  }
  return grid;
}

/** Minimal PersonalCardData for smoke tests — all sections populated. */
const SAMPLE_EN: PersonalCardData = {
  locale: "en-US",
  timeframe: "all_time",
  username: "alice",
  favoritePersonaName: "Tomori",
  favoritePersonaAvatarDataUri: null,
  loyaltyPct: 72,
  totalMessages: 1234,
  heatmap: {
    normalized: makeGrid({ 1: { 20: 0.8 }, 3: { 9: 0.5 } }),
    maxVal: 0.8,
  },
  histogramByHour: null,
  currentStreak: 7,
  longestStreak: 42,
  anniversary: new Date("2024-01-15T00:00:00Z"),
  topModelName: "gemini-1.5-pro",
  estimatedCost: 0.0042,
  topExpression: [
    { key: "happy", count: 30 },
    { key: "wink", count: 20 },
  ],
  conditioning: { rewards: 15, punishments: 3 },
};

/** Japanese-locale variant with Japanese names. */
const SAMPLE_JA: PersonalCardData = {
  ...SAMPLE_EN,
  locale: "ja",
  username: "さくら",
  favoritePersonaName: "友里",
};

// ── 1. countWeekdayOccurrences ─────────────────────────────────────────────────

describe("countWeekdayOccurrences", () => {
  it("counts 1 of each weekday for a full 7-day window", () => {
    // 2024-01-15 (Mon) to 2024-01-21 (Sun) = exactly one of each weekday
    const from = new Date("2024-01-15T00:00:00Z"); // Monday
    const to = new Date("2024-01-21T00:00:00Z"); // Sunday
    const counts = countWeekdayOccurrences(from, to);
    for (let d = 0; d < 7; d++) {
      expect(counts[d]).toBe(1);
    }
  });

  it("counts 5 Mondays in a 31-day January 2024 window", () => {
    // Jan 2024: Mondays on 1,8,15,22,29
    const from = new Date("2024-01-01T00:00:00Z");
    const to = new Date("2024-01-31T00:00:00Z");
    const counts = countWeekdayOccurrences(from, to);
    // 2024-01-01 is a Monday (dow=1)
    expect(counts[1]).toBe(5); // 5 Mondays
    expect(counts[0]).toBe(4); // 4 Sundays (7,14,21,28)
  });

  it("returns 1 for every weekday when from === to (single day)", () => {
    const day = new Date("2024-03-13T00:00:00Z"); // Wednesday
    const counts = countWeekdayOccurrences(day, day);
    expect(counts[3]).toBe(1); // Wednesday
    for (let d = 0; d < 7; d++) {
      if (d !== 3) expect(counts[d]).toBe(0);
    }
  });
});

// ── 2. normalizeHeatmap ────────────────────────────────────────────────────────

describe("normalizeHeatmap", () => {
  it("divides each weekday row by its occurrence count", () => {
    // 14-day window (2×each weekday) starting Monday 2024-01-15
    const from = "2024-01-15"; // Monday
    const today = new Date("2024-01-28T00:00:00Z"); // Sunday (exactly 14 days later)
    // Mon@9 = 20 raw; 2 Mondays in this window → normalized = 10
    const grid = makeGrid({ 1: { 9: 20 } });
    const result = normalizeHeatmap(grid, from, null, today);
    expect(result.normalized[1][9]).toBeCloseTo(10, 5);
    expect(result.maxVal).toBeCloseTo(10, 5);
  });

  it("falls back to anniversary as window start for all-time normalization", () => {
    // all-time (no windowFrom); anniversary = 2024-01-15 (Monday), today = 2024-01-21 (Sunday)
    // → 1 Monday in the window, so Mon@08 = 7 / 1 = 7
    const today = new Date("2024-01-21T00:00:00Z");
    const grid = makeGrid({ 1: { 8: 7 } });
    const anniversary = new Date("2024-01-15T00:00:00Z");
    const result = normalizeHeatmap(grid, undefined, anniversary, today);
    expect(result.normalized[1][8]).toBeCloseTo(7, 5);
  });

  it("returns raw grid when neither windowFrom nor anniversary is provided", () => {
    const grid = makeGrid({ 2: { 14: 99 } });
    const result = normalizeHeatmap(grid, undefined, null);
    expect(result.normalized[2][14]).toBe(99);
    expect(result.maxVal).toBe(99);
  });

  it("maxVal tracks the maximum normalized cell", () => {
    // 7-day window starting Mon 2024-01-15, ending Sun 2024-01-21 → 1 of each weekday
    const today = new Date("2024-01-21T00:00:00Z");
    const grid = makeGrid({ 0: { 0: 5 }, 3: { 12: 11 }, 6: { 23: 3 } });
    const result = normalizeHeatmap(grid, "2024-01-15", null, today);
    expect(result.maxVal).toBeCloseTo(11, 5);
  });
});

// ── 3. Timeframe gating predicates ────────────────────────────────────────────

describe("timeframe gating predicates", () => {
  describe("shouldShowHeatmap", () => {
    it("is true for month, year, all_time", () => {
      expect(shouldShowHeatmap("month")).toBe(true);
      expect(shouldShowHeatmap("year")).toBe(true);
      expect(shouldShowHeatmap("all_time")).toBe(true);
    });

    it("is false for today and week", () => {
      expect(shouldShowHeatmap("today")).toBe(false);
      expect(shouldShowHeatmap("week")).toBe(false);
    });
  });

  describe("shouldShowStreak", () => {
    it("is false only for today", () => {
      expect(shouldShowStreak("today")).toBe(false);
      expect(shouldShowStreak("week")).toBe(true);
      expect(shouldShowStreak("month")).toBe(true);
      expect(shouldShowStreak("year")).toBe(true);
      expect(shouldShowStreak("all_time")).toBe(true);
    });
  });

  describe("shouldShowConditioning", () => {
    it("is true only for all_time", () => {
      expect(shouldShowConditioning("all_time")).toBe(true);
      expect(shouldShowConditioning("today")).toBe(false);
      expect(shouldShowConditioning("week")).toBe(false);
      expect(shouldShowConditioning("month")).toBe(false);
      expect(shouldShowConditioning("year")).toBe(false);
    });
  });
});

// ── 4. renderPersonalCard — pure VNode smoke test ─────────────────────────────

describe("renderPersonalCard", () => {
  it("returns a VNode (object with type and props) from EN sample data", () => {
    const node = renderPersonalCard(SAMPLE_EN);
    expect(node).toBeObject();
    expect(typeof node.type).toBe("string");
    expect(node.props).toBeObject();
  });

  it("returns a VNode from JA sample data (Japanese persona/username)", () => {
    const node = renderPersonalCard(SAMPLE_JA);
    expect(node).toBeObject();
    expect(node.type).toBe("div");
  });

  it("renders the no-data fallback card when totalMessages=0 and no persona", () => {
    const emptyData: PersonalCardData = {
      ...SAMPLE_EN,
      totalMessages: 0,
      favoritePersonaName: null,
    };
    const node = renderPersonalCard(emptyData);
    expect(node).toBeObject();
  });

  it("omits heatmap section when heatmap is null (today/week — ring fallback)", () => {
    const weekData: PersonalCardData = {
      ...SAMPLE_EN,
      timeframe: "week",
      heatmap: null,
      histogramByHour: { 9: 5, 14: 3, 20: 8 },
      currentStreak: 3,
      longestStreak: 7,
    };
    const node = renderPersonalCard(weekData);
    expect(node).toBeObject();
  });

  it("omits conditioning section when conditioning is null (non-all_time)", () => {
    const monthData: PersonalCardData = {
      ...SAMPLE_EN,
      timeframe: "month",
      conditioning: null,
    };
    const node = renderPersonalCard(monthData);
    expect(node).toBeObject();
  });

  it("omits streak section when currentStreak and longestStreak are null (today)", () => {
    const todayData: PersonalCardData = {
      ...SAMPLE_EN,
      timeframe: "today",
      heatmap: null,
      histogramByHour: { 10: 2 },
      currentStreak: null,
      longestStreak: null,
      anniversary: null,
      conditioning: null,
    };
    const node = renderPersonalCard(todayData);
    expect(node).toBeObject();
  });
});

// ── 5. renderCardToPng — raster smoke test ────────────────────────────────────

describe("renderCardToPng", () => {
  it("produces a non-empty PNG buffer for EN card", async () => {
    const { CARD_W, CARD_H } = await import("@/utils/stats/statsInfographic");
    const node = renderPersonalCard(SAMPLE_EN);
    const png = await renderCardToPng(node, CARD_W, CARD_H);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.byteLength).toBeGreaterThan(1000);
    // PNG magic bytes: 137 80 78 71
    expect(png[0]).toBe(137);
    expect(png[1]).toBe(80);
    expect(png[2]).toBe(78);
    expect(png[3]).toBe(71);
  });

  it("produces a non-empty PNG buffer for JA card (Japanese glyph coverage)", async () => {
    const { CARD_W, CARD_H } = await import("@/utils/stats/statsInfographic");
    const node = renderPersonalCard(SAMPLE_JA);
    const png = await renderCardToPng(node, CARD_W, CARD_H);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.byteLength).toBeGreaterThan(1000);
  });
}, 30_000); // satori + resvg can be slow on first run (font loading)
