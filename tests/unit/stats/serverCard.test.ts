/**
 * Unit tests for Phase 3 Chunk 3 — Server "Year in Review" infographic card.
 *
 * Covers (all DB-free, injecting data directly):
 * 1. renderServerCard — pure VNode smoke tests for multiple scenarios.
 * 2. renderCardToPng — PNG raster smoke test for server card.
 */
import { describe, expect, it } from "bun:test";
import type { ServerCardData } from "@/utils/stats/statsInfographic";
import { renderServerCard } from "@/utils/stats/statsInfographic";
import { renderCardToPng } from "@/utils/stats/cardRenderer";

// ── Sample data ───────────────────────────────────────────────────────────────

const SAMPLE_EN: ServerCardData = {
  locale: "en-US",
  timeframe: "all_time",
  serverName: "Tomori Dev Server",
  topChatters: [
    { displayName: "alice", count: 3_421, rank: 1 },
    { displayName: "bob", count: 2_108, rank: 2 },
    { displayName: "carol", count: 987, rank: 3 },
  ],
  topPersonas: [
    { name: "Tomori", count: 4_820, rank: 1 },
    { name: "Lilya", count: 1_204, rank: 2 },
  ],
  generationTotals: { text: 8_230, images: 312, videos: 18 },
  estimatedCost: 4.27,
  peakHour: 21,
  mostLovedExpression: [
    { key: "happy", count: 234 },
    { key: "smug", count: 187 },
    { key: "wink", count: 143 },
  ],
  topCommands: [
    { command: "stats personal", count: 89 },
    { command: "config setup", count: 54 },
    { command: "teach memory", count: 37 },
  ],
};

const SAMPLE_JA: ServerCardData = {
  ...SAMPLE_EN,
  locale: "ja",
  serverName: "友里のサーバー",
  topChatters: [
    { displayName: "さくら", count: 3_421, rank: 1 },
    { displayName: "はじめ", count: 2_108, rank: 2 },
  ],
  topPersonas: [{ name: "友里", count: 4_820, rank: 1 }],
  mostLovedExpression: [
    { key: "うれしい", count: 234 },
    { key: "ドヤ顔", count: 187 },
  ],
};

// ── 1. renderServerCard — pure VNode smoke tests ───────────────────────────────

describe("renderServerCard", () => {
  it("returns a VNode from EN sample data", () => {
    const node = renderServerCard(SAMPLE_EN);
    expect(node).toBeObject();
    expect(typeof node.type).toBe("string");
    expect(node.props).toBeObject();
  });

  it("returns a VNode from JA sample data (Japanese server name and persona)", () => {
    const node = renderServerCard(SAMPLE_JA);
    expect(node).toBeObject();
    expect(node.type).toBe("div");
  });

  it("renders no-data fallback when all lists are empty", () => {
    const emptyData: ServerCardData = {
      locale: "en-US",
      timeframe: "week",
      serverName: "Empty Server",
      topChatters: [],
      topPersonas: [],
      generationTotals: null,
      estimatedCost: 0,
      peakHour: null,
      mostLovedExpression: [],
      topCommands: [],
    };
    const node = renderServerCard(emptyData);
    expect(node).toBeObject();
  });

  it("omits generation totals section when generationTotals is null (non-all_time)", () => {
    const weekData: ServerCardData = {
      ...SAMPLE_EN,
      timeframe: "week",
      generationTotals: null,
    };
    const node = renderServerCard(weekData);
    expect(node).toBeObject();
  });

  it("renders correctly when peakHour is null (no activity data)", () => {
    const data: ServerCardData = { ...SAMPLE_EN, peakHour: null };
    const node = renderServerCard(data);
    expect(node).toBeObject();
  });

  it("handles boundary hour values (0 = midnight, 23 = 11 PM)", () => {
    const midnight = renderServerCard({ ...SAMPLE_EN, peakHour: 0 });
    const lateNight = renderServerCard({ ...SAMPLE_EN, peakHour: 23 });
    expect(midnight).toBeObject();
    expect(lateNight).toBeObject();
  });
});

// ── 2. renderCardToPng — raster smoke test ─────────────────────────────────────

describe("renderServerCard PNG", () => {
  it("produces a non-empty PNG buffer for EN server card", async () => {
    const { CARD_W, SERVER_CARD_H } = await import("@/utils/stats/statsInfographic");
    const node = renderServerCard(SAMPLE_EN);
    const png = await renderCardToPng(node, CARD_W, SERVER_CARD_H);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.byteLength).toBeGreaterThan(1000);
    // PNG magic bytes
    expect(png[0]).toBe(137);
    expect(png[1]).toBe(80);
    expect(png[2]).toBe(78);
    expect(png[3]).toBe(71);
  });

  it("produces a non-empty PNG buffer for JA server card", async () => {
    const { CARD_W, SERVER_CARD_H } = await import("@/utils/stats/statsInfographic");
    const node = renderServerCard(SAMPLE_JA);
    const png = await renderCardToPng(node, CARD_W, SERVER_CARD_H);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.byteLength).toBeGreaterThan(1000);
  });
}, 30_000);
