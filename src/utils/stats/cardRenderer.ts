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

  // fontBuffers is missing from @resvg/resvg-js v2.6.2 types, so assigning a variable avoids excess-property checks.
  const resvgFontOpts = { fontBuffers: [regular, bold], loadSystemFonts: false, defaultFontFamily: FONT_NAME };
  const resvg = new Resvg(svg, { font: resvgFontOpts });

  return Buffer.from(resvg.render().asPng());
}
