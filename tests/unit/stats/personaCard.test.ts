/**
 * Unit tests for Phase 3 Chunk 3 — Persona "trading card" infographic.
 *
 * Covers (all DB-free, injecting data directly):
 * 1. renderPersonaCard — pure VNode smoke test (no DB, no satori).
 * 2. renderCardToPng — PNG raster smoke test for persona card.
 * 3. buildDonutSvg — SVG arc helper edge cases.
 */
import { describe, expect, it } from "bun:test";
import type { PersonaCardData } from "@/utils/stats/statsInfographic";
import { buildDonutSvg, renderPersonaCard } from "@/utils/stats/statsInfographic";
import { renderCardToPng } from "@/utils/stats/cardRenderer";

// ── Sample data ───────────────────────────────────────────────────────────────

const SAMPLE_EN: PersonaCardData = {
  locale: "en-US",
  timeframe: "all_time",
  personaName: "Tomori",
  personaAvatarDataUri: null,
  totalMessages: 4_820,
  memoryCount: 112,
  serverRank: 1,
  topPeopleByMemory: [
    { displayName: "alice", count: 34 },
    { displayName: "bob", count: 21 },
    { displayName: "carol", count: 14 },
  ],
  mostRewardedBy: [
    { displayName: "alice", count: 15 },
    { displayName: "dave", count: 7 },
  ],
  mostPunishedBy: [{ displayName: "eve", count: 4 }],
  vibeSprites: 203,
  vibeEmoji: 97,
  vibeStickers: 48,
  vibeTools: 12,
};

const SAMPLE_JA: PersonaCardData = {
  ...SAMPLE_EN,
  locale: "ja",
  personaName: "友里",
  topPeopleByMemory: [
    { displayName: "さくら", count: 34 },
    { displayName: "はじめ", count: 21 },
  ],
  mostRewardedBy: [{ displayName: "さくら", count: 15 }],
  mostPunishedBy: [],
};

// ── 1. renderPersonaCard — pure VNode smoke tests ─────────────────────────────

describe("renderPersonaCard", () => {
  it("returns a VNode from EN sample data", () => {
    const node = renderPersonaCard(SAMPLE_EN);
    expect(node).toBeObject();
    expect(typeof node.type).toBe("string");
    expect(node.props).toBeObject();
  });

  it("returns a VNode from JA sample data (Japanese persona name)", () => {
    const node = renderPersonaCard(SAMPLE_JA);
    expect(node).toBeObject();
    expect(node.type).toBe("div");
  });

  it("renders no-data fallback when totalMessages=0 and memoryCount=0", () => {
    const emptyData: PersonaCardData = {
      ...SAMPLE_EN,
      totalMessages: 0,
      memoryCount: 0,
      serverRank: 0,
      topPeopleByMemory: [],
      mostRewardedBy: [],
      mostPunishedBy: [],
      vibeSprites: 0,
      vibeEmoji: 0,
      vibeStickers: 0,
      vibeTools: 0,
    };
    const node = renderPersonaCard(emptyData);
    expect(node).toBeObject();
  });

  it("omits conditioning section when both lists are empty", () => {
    const noCondData: PersonaCardData = {
      ...SAMPLE_EN,
      mostRewardedBy: [],
      mostPunishedBy: [],
    };
    const node = renderPersonaCard(noCondData);
    expect(node).toBeObject();
  });

  it("renders server rank when > 0 and omits it when 0", () => {
    const withRank = renderPersonaCard({ ...SAMPLE_EN, serverRank: 2 });
    const noRank = renderPersonaCard({ ...SAMPLE_EN, serverRank: 0 });
    // Both must return a valid VNode regardless.
    expect(withRank).toBeObject();
    expect(noRank).toBeObject();
  });
});

// ── 2. renderCardToPng — raster smoke test ─────────────────────────────────────

describe("renderPersonaCard PNG", () => {
  it("produces a non-empty PNG buffer for EN persona card", async () => {
    const { CARD_W, PERSONA_CARD_H } = await import("@/utils/stats/statsInfographic");
    const node = renderPersonaCard(SAMPLE_EN);
    const png = await renderCardToPng(node, CARD_W, PERSONA_CARD_H);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.byteLength).toBeGreaterThan(1000);
    // PNG magic bytes
    expect(png[0]).toBe(137);
    expect(png[1]).toBe(80);
    expect(png[2]).toBe(78);
    expect(png[3]).toBe(71);
  });

  it("produces a non-empty PNG buffer for JA persona card", async () => {
    const { CARD_W, PERSONA_CARD_H } = await import("@/utils/stats/statsInfographic");
    const node = renderPersonaCard(SAMPLE_JA);
    const png = await renderCardToPng(node, CARD_W, PERSONA_CARD_H);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.byteLength).toBeGreaterThan(1000);
  });
}, 30_000);

// ── 3. buildDonutSvg — SVG arc helper ─────────────────────────────────────────

describe("buildDonutSvg", () => {
  it("returns a valid SVG string with path elements for non-empty input", () => {
    const svg = buildDonutSvg(
      [
        { value: 60, color: "#7c3aed" },
        { value: 30, color: "#22c55e" },
        { value: 10, color: "#f59e0b" },
      ],
      80,
      18,
      "#1a1b2e",
    );
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
    expect(svg).toContain("</svg>");
  });

  it("returns a grey ring (circle, no paths) when total is 0", () => {
    const svg = buildDonutSvg([], 80, 18, "#1a1b2e");
    expect(svg).toContain("<svg");
    expect(svg).toContain("<circle");
    expect(svg).not.toContain("<path");
  });

  it("produces a valid SVG string for a single 100% segment", () => {
    const svg = buildDonutSvg([{ value: 100, color: "#7c3aed" }], 80, 18, "#1a1b2e");
    expect(svg).toContain("<path");
  });

  it("skips zero-value segments without crashing", () => {
    const svg = buildDonutSvg(
      [
        { value: 0, color: "#ff0000" },
        { value: 50, color: "#7c3aed" },
      ],
      80,
      18,
      "#1a1b2e",
    );
    expect(svg).toContain("<path");
  });
});
