/**
 * Renders representative EN and JA stats cards without a database or
 * Discord connection. Usage: bun run scripts/devtools/renderPersonalCardHarness.ts [outputDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderCardToPng } from "@/utils/stats/cardRenderer";
import type { PersonaCardData, PersonalCardData, ServerCardData } from "@/utils/stats/statsInfographic";
import {
  CARD_W,
  DEFAULT_PERSONAL_CARD_PALETTE,
  getPersonalCardHeight,
  getPersonaCardHeight,
  getServerCardHeight,
  renderPersonalCard,
  renderPersonaCard,
  renderServerCard,
} from "@/utils/stats/statsInfographic";
import { initializeLocalizer } from "@/utils/text/localizer";

const TOMORICON_DATA_URI = `data:image/png;base64,${readFileSync(resolve("assets/img/tomoricon-mono-dark.png")).toString("base64")}`;

const PERSONAL_EN: PersonalCardData = {
  locale: "en-US",
  timeframe: "all_time",
  username: "alice",
  userAvatarDataUri: null,
  tomoriconDataUri: TOMORICON_DATA_URI,
  palette: DEFAULT_PERSONAL_CARD_PALETTE,
  totalTokens: 56_951,
  totalTriggers: 1_234,
  estimatedCost: 0.0317,
  favoritePersonas: [
    { name: "Tomori", avatarDataUri: null, totalTokens: 31_386, estimatedCost: 0.0213 },
    { name: "Lilya", avatarDataUri: null, totalTokens: 14_673, estimatedCost: 0.0074 },
    { name: "Mutsumi", avatarDataUri: null, totalTokens: 10_892, estimatedCost: 0.003 },
  ],
  favoriteModelName: "gemini-1.5-pro",
  heroVariant: 0,
};

const PERSONAL_JA: PersonalCardData = {
  ...PERSONAL_EN,
  locale: "ja",
  username: "さくら",
  favoritePersonas: [
    { name: "友里", avatarDataUri: null, totalTokens: 42_278, estimatedCost: 0.024 },
    { name: "立希", avatarDataUri: null, totalTokens: 14_673, estimatedCost: 0.0077 },
  ],
};

const PERSONA_EN: PersonaCardData = {
  locale: "en-US",
  timeframe: "all_time",
  username: "alice",
  userAvatarDataUri: null,
  personaName: "Tomori",
  personaAvatarDataUri: null,
  inputTokens: 31_386,
  outputTokens: 4_820,
  totalTriggers: 867,
  sharePct: 70.3,
  estimatedCost: 0.0213,
  memoryCount: 112,
  conditioning: { rewards: 27, punishments: 5 },
  favoriteEmojis: [
    { name: "happy", imageDataUri: null },
    { name: "wink", imageDataUri: null },
  ],
  favoriteEmotions: [
    { label: "happy", count: 142 },
    { label: "smug", count: 87 },
    { label: "embarrassed", count: 64 },
  ],
  favoriteTools: [
    { label: "web_search", count: 12 },
    { label: "memory", count: 8 },
  ],
};

const PERSONA_JA: PersonaCardData = {
  ...PERSONA_EN,
  locale: "ja",
  username: "さくら",
  personaName: "友里",
  favoriteEmotions: [{ label: "うれしい", count: 142 }],
};

const SERVER_EN: ServerCardData = {
  locale: "en-US",
  timeframe: "all_time",
  serverName: "Tomori Dev Server",
  serverIconDataUri: null,
  topPersonas: [
    { name: "Tomori", avatarDataUri: null, rank: 1, inputTokens: 31_386, outputTokens: 4_820, sharePct: 62.4 },
    { name: "Lilya", avatarDataUri: null, rank: 2, inputTokens: 12_402, outputTokens: 1_204, sharePct: 18.2 },
    { name: "Mutsumi", avatarDataUri: null, rank: 3, inputTokens: 8_121, outputTokens: 892, sharePct: 10.6 },
  ],
  topHumans: [
    { name: "alice", avatarDataUri: null, rank: 1, triggers: 3_421, estimatedCost: 1.27 },
    { name: "bob", avatarDataUri: null, rank: 2, triggers: 2_108, estimatedCost: 0.88 },
    { name: "carol", avatarDataUri: null, rank: 3, triggers: 987, estimatedCost: 0.42 },
  ],
  topModelName: "gemini-1.5-pro",
  inputTokens: 84_210,
  outputTokens: 12_408,
  estimatedCost: 4.27,
  totalTriggers: 8_230,
  topPersonaEmojis: [
    { name: "happy", imageDataUri: null },
    { name: "smug", imageDataUri: null },
    { name: "wink", imageDataUri: null },
  ],
};

const SERVER_JA: ServerCardData = {
  ...SERVER_EN,
  locale: "ja",
  serverName: "友里のサーバー",
  topPersonas: [{ name: "友里", avatarDataUri: null, rank: 1, inputTokens: 31_386, outputTokens: 4_820, sharePct: 62.4 }],
  topHumans: [{ name: "さくら", avatarDataUri: null, rank: 1, triggers: 3_421, estimatedCost: 1.27 }],
};

async function main(): Promise<void> {
  await initializeLocalizer();
  const outputDir = resolve(process.argv[2] ?? ".card-output");
  mkdirSync(outputDir, { recursive: true });

  const variants = [
    ["personal-en", renderPersonalCard(PERSONAL_EN), getPersonalCardHeight(PERSONAL_EN)],
    ["personal-ja", renderPersonalCard(PERSONAL_JA), getPersonalCardHeight(PERSONAL_JA)],
    ["persona-en", renderPersonaCard(PERSONA_EN), getPersonaCardHeight(PERSONA_EN)],
    ["persona-ja", renderPersonaCard(PERSONA_JA), getPersonaCardHeight(PERSONA_JA)],
    ["server-en", renderServerCard(SERVER_EN), getServerCardHeight(SERVER_EN)],
    ["server-ja", renderServerCard(SERVER_JA), getServerCardHeight(SERVER_JA)],
  ] as const;

  for (const [name, node, height] of variants) {
    const png = await renderCardToPng(node, CARD_W, height);
    const outputPath = join(outputDir, `${name}.png`);
    writeFileSync(outputPath, png);
    console.log(`[harness] wrote ${outputPath} (${png.byteLength} bytes)`);
  }
}

main().catch((error) => {
  console.error("[harness] FAILED:", error);
  process.exit(1);
});
