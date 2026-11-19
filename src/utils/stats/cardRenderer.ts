// Both satori and resvg receive cached font buffers directly so rendering has no host fontconfig dependency on the
// fontless Alpine prod image.
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

function ensureFonts(): { regular: Buffer; bold: Buffer } {
  if (!cachedRegular) cachedRegular = readFileSync(FONT_REGULAR_PATH);
  if (!cachedBold) cachedBold = readFileSync(FONT_BOLD_PATH);
  return { regular: cachedRegular, bold: cachedBold };
}

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
