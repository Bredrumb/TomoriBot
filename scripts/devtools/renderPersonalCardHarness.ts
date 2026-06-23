/**
 * renderPersonalCardHarness.ts — dev render harness for all three Phase 3
 * infographic cards: Personal "Wrapped", Persona "trading card", and Server
 * "Year in Review" (plans/stat-tracking.md §10).
 *
 * Builds representative card data BY HAND (no DB, no Discord API) and writes
 * EN and JA variant PNGs to disk for visual inspection. Run this to verify:
 *   - Japanese persona names and usernames render without tofu.
 *   - Layout sections appear as expected per card type.
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
import type { PersonaCardData, PersonalCardData, ServerCardData } from "@/utils/stats/statsInfographic";
import {
  CARD_W,
  PERSONAL_CARD_H,
  PERSONA_CARD_H,
  SERVER_CARD_H,
  renderPersonalCard,
  renderPersonaCard,
  renderServerCard,
} from "@/utils/stats/statsInfographic";

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

// ── Personal card samples ──────────────────────────────────────────────────────

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

// ── Persona card samples ───────────────────────────────────────────────────────

const PERSONA_EN: PersonaCardData = {
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
  mostPunishedBy: [
    { displayName: "eve", count: 4 },
  ],
  vibeSprites: 203,
  vibeEmoji: 97,
  vibeStickers: 48,
  vibeTools: 12,
};

const PERSONA_JA: PersonaCardData = {
  ...PERSONA_EN,
  locale: "ja",
  personaName: "友里",
  topPeopleByMemory: [
    { displayName: "さくら", count: 34 },
    { displayName: "はじめ", count: 21 },
    { displayName: "ゆかり", count: 14 },
  ],
  mostRewardedBy: [{ displayName: "さくら", count: 15 }],
  mostPunishedBy: [{ displayName: "はじめ", count: 4 }],
};

const PERSONA_EMPTY: PersonaCardData = {
  locale: "en-US",
  timeframe: "all_time",
  personaName: "Lilya",
  personaAvatarDataUri: null,
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

// ── Server card samples ────────────────────────────────────────────────────────

const SERVER_EN: ServerCardData = {
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
    { command: "generate image", count: 22 },
  ],
};

const SERVER_JA: ServerCardData = {
  ...SERVER_EN,
  locale: "ja",
  serverName: "友里のサーバー",
  topChatters: [
    { displayName: "さくら", count: 3_421, rank: 1 },
    { displayName: "はじめ", count: 2_108, rank: 2 },
    { displayName: "ゆかり", count: 987, rank: 3 },
  ],
  topPersonas: [
    { name: "友里", count: 4_820, rank: 1 },
    { name: "リリャ", count: 1_204, rank: 2 },
  ],
  mostLovedExpression: [
    { key: "うれしい", count: 234 },
    { key: "ドヤ顔", count: 187 },
    { key: "照れ", count: 143 },
  ],
};

const SERVER_EMPTY: ServerCardData = {
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

// ── Render and write ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const outDir = resolve(process.argv[2] ?? ".card-output");
  mkdirSync(outDir, { recursive: true });

  type PersonalVariant = { kind: "personal"; name: string; data: PersonalCardData };
  type PersonaVariant = { kind: "persona"; name: string; data: PersonaCardData };
  type ServerVariant = { kind: "server"; name: string; data: ServerCardData };
  type Variant = PersonalVariant | PersonaVariant | ServerVariant;

  const variants: Variant[] = [
    // Personal
    { kind: "personal", name: "personal-en", data: EN_DATA },
    { kind: "personal", name: "personal-ja", data: JA_DATA },
    { kind: "personal", name: "personal-week", data: WEEK_DATA },
    { kind: "personal", name: "personal-empty", data: EMPTY_DATA },
    // Persona
    { kind: "persona", name: "persona-en", data: PERSONA_EN },
    { kind: "persona", name: "persona-ja", data: PERSONA_JA },
    { kind: "persona", name: "persona-empty", data: PERSONA_EMPTY },
    // Server
    { kind: "server", name: "server-en", data: SERVER_EN },
    { kind: "server", name: "server-ja", data: SERVER_JA },
    { kind: "server", name: "server-empty", data: SERVER_EMPTY },
  ];

  for (const variant of variants) {
    console.log(`[harness] rendering ${variant.name}…`);

    let png: Buffer;
    if (variant.kind === "personal") {
      const node = renderPersonalCard(variant.data);
      png = await renderCardToPng(node, CARD_W, PERSONAL_CARD_H);
    } else if (variant.kind === "persona") {
      const node = renderPersonaCard(variant.data);
      png = await renderCardToPng(node, CARD_W, PERSONA_CARD_H);
    } else {
      const node = renderServerCard(variant.data);
      png = await renderCardToPng(node, CARD_W, SERVER_CARD_H);
    }

    const outPath = join(outDir, `${variant.name}.png`);
    writeFileSync(outPath, png);
    console.log(`[harness] wrote ${outPath} (${png.byteLength} bytes)`);
  }

  console.log("\n[harness] done. Open the .png files to verify:");
  console.log("  personal  — heatmap / ring / streak / conditioning / expression sections");
  console.log("  persona   — stat block / people I remember / conditioning / vibe bars");
  console.log("  server    — podium / persona list / generation totals / peak hour / commands");
  console.log("  *-ja      — Japanese glyphs render without tofu");
  console.log("  *-empty   — no-data fallback renders gracefully");
}

main().catch((error) => {
  console.error("[harness] FAILED:", error);
  process.exit(1);
});
