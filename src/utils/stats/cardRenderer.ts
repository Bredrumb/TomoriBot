/**
 * cardRenderer.ts: production rasterizer for the `/stats generate` infographic.
 *
 * Graduates the font-loading + render pipeline from the Chunk 1 spike into real
 * module-level code. Font buffers are loaded ONCE (readFileSync at first call,
 * then module-cached) and reused for every card render so the 5.5 MB per-weight
 * read cost is paid exactly once per process lifetime.
 *
 * Pipeline: VNode → satori (SVG) → @resvg/resvg-js (PNG buffer).
 * Both stages receive the SAME font buffers directly, so no host fontconfig
 * dependency (required for Alpine prod image which ships no fonts).
 */
import { Resvg } from "@resvg/resvg-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import satori from "satori";
import type { VNode } from "@/utils/stats/statsInfographic";

const FONT_NAME = "Noto Sans JP";
const FONT_REGULAR_PATH = resolve("assets/fonts/NotoSansJP-Regular.ttf");
const FONT_BOLD_PATH = resolve("assets/fonts/NotoSansJP-Bold.ttf");

// Module-level buffer cache: loaded synchronously on first renderCardToPng call.
let cachedRegular: Buffer | null = null;
let cachedBold: Buffer | null = null;

/**
 * Returns the two static font weight buffers, loading them from disk on first call
 * and returning the cached copy on all subsequent calls.
 */
function ensureFonts(): { regular: Buffer; bold: Buffer } {
  if (!cachedRegular) cachedRegular = readFileSync(FONT_REGULAR_PATH);
  if (!cachedBold) cachedBold = readFileSync(FONT_BOLD_PATH);
  return { regular: cachedRegular, bold: cachedBold };
}

/**
 * Rasterizes a satori VNode to a PNG buffer.
 *
 * 1. Ensures both font weight buffers are in memory.
 * 2. Runs satori (JSX → SVG) with both weights registered.
 * 3. Runs @resvg/resvg-js (SVG → PNG) with the same font buffers.
 *
 * @param width  - Output image width in pixels.
 * @param height - Output image height in pixels.
 */
export async function renderCardToPng(node: VNode, width: number, height: number): Promise<Buffer> {
  const { regular, bold } = ensureFonts();

  const svg = await satori(node, {
    width,
    height,
    fonts: [
      { name: FONT_NAME, data: regular, weight: 400, style: "normal" },
      { name: FONT_NAME, data: bold, weight: 700, style: "normal" },
    ],
  });

  // @resvg/resvg-js: SVG → PNG (uses the same font buffers for rasterization).
  // fontBuffers is the runtime API for passing Buffer[] directly but is absent
  // from the v2.6.2 type declarations. Assigning to a variable first avoids
  // TypeScript's excess-property literal check while keeping runtime behavior.
  const resvgFontOpts = { fontBuffers: [regular, bold], loadSystemFonts: false, defaultFontFamily: FONT_NAME };
  const resvg = new Resvg(svg, { font: resvgFontOpts });

  return Buffer.from(resvg.render().asPng());
}
