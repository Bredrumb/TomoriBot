/**
 * statsRenderSpike.ts — THROWAWAY Phase 3 CHUNK 1 gate (plans/stat-tracking.md §10).
 *
 * Proves the `/stats generate` rendering stack end-to-end, independent of host
 * fonts:
 *   1. load the bundled Noto Sans JP buffer from assets/fonts/ via fs,
 *   2. satori (JSX → SVG) using that buffer to MEASURE + emit live glyph paths,
 *   3. @resvg/resvg-js (SVG → PNG) using the SAME buffer to RASTERIZE,
 *   4. write the SVG + PNG to disk for inspection, and
 *   5. diff a regular-vs-bold glyph probe to detect the variable-font weight trap.
 *
 * The whole point is to run this INSIDE the prod Alpine image (which installs no
 * fonts) and confirm the Japanese glyphs rasterize as real shapes, not tofu.
 * See the report in the chunk-1 hand-off for the exact docker commands used.
 *
 * Run: `bun run scripts/devtools/statsRenderSpike.ts [outputDir]`
 *      (outputDir defaults to ./.spike-output)
 *
 * This file lives under scripts/ which is excluded from `tsc` include and biome
 * lint — it is dev tooling, not shipped code, and is expected to be deleted once
 * the gate is signed off.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { type SpikeFont, renderSpikeSvg, renderWeightProbeSvg } from "@/utils/stats/statsInfographic";

const FONT_NAME = "Noto Sans JP";
// Static instances (wght 400 / 700) pinned out of the bundled VF with fonttools:
// satori's opentype.js fork crashes parsing the VF's fvar table, so we register
// two static weight buffers instead (see assets/fonts/README.md).
const FONT_REGULAR_PATH = resolve("assets/fonts/NotoSansJP-Regular.ttf");
const FONT_BOLD_PATH = resolve("assets/fonts/NotoSansJP-Bold.ttf");

/** Concatenates every `d="…"` glyph path in an SVG — the deterministic render fingerprint. */
function glyphPathFingerprint(svg: string): string {
  const matches = svg.match(/ d="[^"]*"/g) ?? [];
  return matches.join("");
}

/** Rasterizes an SVG to a PNG buffer, passing the SAME font buffers resvg needs (no fontconfig). */
function rasterize(svg: string, fontBuffers: Buffer[]): Buffer {
  const resvg = new Resvg(svg, {
    font: {
      // 1. Hand resvg the font buffers directly — Alpine has no system fonts/fontconfig.
      fontBuffers,
      loadSystemFonts: false,
      defaultFontFamily: FONT_NAME,
    },
  });
  return Buffer.from(resvg.render().asPng());
}

async function main(): Promise<void> {
  const outDir = resolve(process.argv[2] ?? ".spike-output");
  mkdirSync(outDir, { recursive: true });

  // 1. Load both static font buffers once (shared by BOTH satori and resvg —
  //    that shared-buffer contract is the whole point of the stack).
  const regularBuffer = readFileSync(FONT_REGULAR_PATH);
  const boldBuffer = readFileSync(FONT_BOLD_PATH);
  console.log(`[spike] loaded regular ${regularBuffer.byteLength} B, bold ${boldBuffer.byteLength} B`);

  // 2. Register each weight as its own static buffer. resvg only needs one
  //    family for fallback, but satori picks the buffer matching font-weight.
  const fonts: SpikeFont[] = [
    { name: FONT_NAME, data: regularBuffer, weight: 400 },
    { name: FONT_NAME, data: boldBuffer, weight: 700 },
  ];

  // 3. Render the mixed EN/JA card → SVG → PNG.
  const cardSvg = await renderSpikeSvg(fonts);
  const cardPng = rasterize(cardSvg, [regularBuffer, boldBuffer]);
  const svgPath = join(outDir, "spike-card.svg");
  const pngPath = join(outDir, "spike-card.png");
  writeFileSync(svgPath, cardSvg);
  writeFileSync(pngPath, cardPng);
  console.log(`[spike] wrote ${svgPath} (${cardSvg.length} chars)`);
  console.log(`[spike] wrote ${pngPath} (${cardPng.byteLength} bytes PNG)`);

  // 4. Japanese-coverage signal: count glyph paths in the card SVG. A card whose
  //    JA glyphs fell back to tofu/empty would emit far fewer/empty paths.
  const cardPaths = (cardSvg.match(/<path /g) ?? []).length;
  console.log(`[spike] card SVG glyph <path> count: ${cardPaths}`);
  if (cardPng.byteLength < 1000) {
    throw new Error("[spike] PNG suspiciously small — rasterization likely failed");
  }

  // 5. Weight-axis probe: same string, 400 vs 700, diff the emitted glyph paths.
  const probeText = "Bold テスト";
  const [svg400, svg700] = await Promise.all([
    renderWeightProbeSvg(probeText, 400, fonts),
    renderWeightProbeSvg(probeText, 700, fonts),
  ]);
  const boldDiffers = glyphPathFingerprint(svg400) !== glyphPathFingerprint(svg700);
  console.log(
    boldDiffers
      ? "[spike] WEIGHT OK — bold (700) glyph paths differ from regular (400); the weight axis renders."
      : "[spike] WEIGHT TRAP — bold (700) glyph paths are IDENTICAL to regular (400); the variable weight axis is ignored. Swap in static NotoSansJP-Regular.ttf + NotoSansJP-Bold.ttf.",
  );

  console.log("[spike] done.");
}

main().catch((error) => {
  console.error("[spike] FAILED:", error);
  process.exit(1);
});
