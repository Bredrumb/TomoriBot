/**
 * renderPersonalCardHarness.ts — dev render harness for the Personal "Wrapped"
 * infographic card (Phase 3 Chunk 2, plans/stat-tracking.md §10).
 *
 * Builds representative PersonalCardData BY HAND (no DB) and writes EN and JA
 * variant PNGs to disk for visual inspection. Run this to verify:
 *   - Japanese persona names and usernames render without tofu.
 *   - Layout sections (heatmap, streak, conditioning, expression) all appear.
 *   - "no data" fallback renders gracefully.
 *
 * Usage:
 *   bun run scripts/devtools/renderPersonalCardHarness.ts [outputDir]
 *   (outputDir defaults to ./.card-output)
 *
 * This file lives under scripts/ which is excluded from `tsc` include and biome
 * lint — it is dev tooling, not shipped code.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ActivityHeatmap } from "@/utils/db/repositories/StatRepository";
import { renderCardToPng } from "@/utils/stats/cardRenderer";
import type { PersonalCardData } from "@/utils/stats/statsInfographic";
import { CARD_H, CARD_W, renderPersonalCard } from "@/utils/stats/statsInfographic";

// ── Sample heatmap (synthesized without DB) ────────────────────────────────────

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

// Synthetic heatmap — peaks in late evening on weekdays
const SAMPLE_GRID = makeGrid({
  1: { 19: 1.2, 20: 2.1, 21: 1.8, 22: 0.9 }, // Mon evenings
  2: { 20: 1.5, 21: 2.4, 22: 1.1 }, // Tue evenings
  3: { 19: 0.8, 20: 1.9, 21: 2.2, 22: 1.4 }, // Wed evenings
  4: { 20: 2.0, 21: 2.8, 22: 1.6 }, // Thu evenings (peak)
  5: { 14: 0.6, 19: 1.1, 20: 2.3, 21: 1.5 }, // Fri afternoon + evening
  6: { 13: 0.9, 14: 1.2, 15: 0.8 }, // Sat afternoon
  0: { 12: 0.7, 13: 0.5 }, // Sun lunchtime
});

// ── Sample card data ───────────────────────────────────────────────────────────

const EN_DATA: PersonalCardData = {
  locale: "en-US",
  timeframe: "all_time",
  username: "alice#1234",

  favoritePersonaName: "Tomori",
  favoritePersonaAvatarDataUri: null, // no remote fetch in harness
  loyaltyPct: 72.4,

  totalMessages: 8_321,

  heatmap: { normalized: SAMPLE_GRID, maxVal: 2.8 },
  histogramByHour: null,

  currentStreak: 14,
  longestStreak: 63,
  anniversary: new Date("2024-02-14T00:00:00Z"),

  topModelName: "gemini-1.5-pro",
  estimatedCost: 0.0317,

  topExpression: [
    { key: "happy", count: 142 },
    { key: "smug", count: 87 },
    { key: "embarrassed", count: 64 },
    { key: "surprised", count: 41 },
    { key: "wink", count: 38 },
  ],

  conditioning: { rewards: 27, punishments: 5 },
};

// Japanese variant with Japanese persona name and username
const JA_DATA: PersonalCardData = {
  ...EN_DATA,
  locale: "ja",
  username: "さくら",
  favoritePersonaName: "友里",
  topExpression: [
    { key: "うれしい", count: 142 },
    { key: "ドヤ顔", count: 87 },
    { key: "照れ", count: 64 },
    { key: "びっくり", count: 41 },
    { key: "ウインク", count: 38 },
  ],
};

// Week-timeframe variant — no heatmap, shows 24h ring fallback; no conditioning
const WEEK_DATA: PersonalCardData = {
  ...EN_DATA,
  timeframe: "week",
  heatmap: null,
  histogramByHour: { 9: 3, 12: 5, 14: 2, 19: 7, 20: 9, 21: 6, 22: 4 },
  currentStreak: 5,
  longestStreak: 14,
  conditioning: null,
};

// No-data fallback
const EMPTY_DATA: PersonalCardData = {
  locale: "en-US",
  timeframe: "all_time",
  username: "newuser",
  favoritePersonaName: null,
  favoritePersonaAvatarDataUri: null,
  loyaltyPct: 0,
  totalMessages: 0,
  heatmap: null,
  histogramByHour: null,
  currentStreak: null,
  longestStreak: null,
  anniversary: null,
  topModelName: null,
  estimatedCost: 0,
  topExpression: [],
  conditioning: null,
};

// ── Render and write ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const outDir = resolve(process.argv[2] ?? ".card-output");
  mkdirSync(outDir, { recursive: true });

  const variants: Array<{ name: string; data: PersonalCardData }> = [
    { name: "personal-en", data: EN_DATA },
    { name: "personal-ja", data: JA_DATA },
    { name: "personal-week", data: WEEK_DATA },
    { name: "personal-empty", data: EMPTY_DATA },
  ];

  for (const { name, data } of variants) {
    console.log(`[harness] rendering ${name}…`);
    const node = renderPersonalCard(data);
    const png = await renderCardToPng(node, CARD_W, CARD_H);
    const outPath = join(outDir, `${name}.png`);
    writeFileSync(outPath, png);
    console.log(`[harness] wrote ${outPath} (${png.byteLength} bytes)`);
  }

  console.log("[harness] done. Open the .png files to verify:");
  console.log("  - English card renders cleanly with all sections visible");
  console.log("  - Japanese card shows さくら / 友里 without tofu");
  console.log("  - Week card shows 24h bar chart instead of heatmap");
  console.log("  - Empty card shows the no-data fallback");
}

main().catch((error) => {
  console.error("[harness] FAILED:", error);
  process.exit(1);
});
