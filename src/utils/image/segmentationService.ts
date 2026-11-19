import sharp from "sharp";
import { GoogleGenAI, HarmBlockThreshold, HarmCategory, type SafetySetting } from "@google/genai";
import { log } from "../misc/logger";
import { omitGeminiSampling } from "@/utils/provider/samplingControl";
import { buildGoogleThinkingConfig } from "@/utils/provider/thinkingControl";

const NAI_INPAINT_DEBUG = (process.env.NAI_INPAINT_DEBUG || "false").toLowerCase() === "true";

const NAI_SEGMENTATION_MODEL = process.env.NAI_SEGMENTATION_MODEL || "gemini-2.5-flash";

const NAI_SEGMENTATION_TIMEOUT_MS = Number.parseInt(process.env.NAI_SEGMENTATION_TIMEOUT_MS || "90000", 10);

// Fraction of each box dimension added as per-side padding (clamped to image bounds), so details such as wispy hair
// or fabric outside Gemini's box are captured.
const NAI_INPAINT_PADDING = 0.15;

// Safety thresholds are OFF because anime and artistic images often trigger false positives that make Gemini hang or
// return empty responses instead of masks.
const SEGMENTATION_SAFETY_SETTINGS: SafetySetting[] = [
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.OFF,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.OFF,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.OFF,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.OFF,
  },
];

interface GeminiSegment {
  // Gemini returns [y0, x0, y1, x1] coordinates normalized to 0-1000 instead of standard x-first pixel bounds, so
  // tuple order must not be swapped.
  box_2d: [number, number, number, number];
  mask: string;
  label: string;
}

export interface SegmentationResult {
  // NovelAI inpainting reads white pixels (alpha 255) as the redraw region and black pixels (alpha 0) as preserved,
  // so polarity cannot be flipped.
  maskBase64: string;
  segmentCount: number;
  labels: string[];
  imageWidth: number;
  imageHeight: number;
  debugMaskBuffer?: Buffer;
  debugOverlayBuffer?: Buffer;
}

async function callGeminiSegmentation(
  imageBase64: string,
  imageMimeType: string,
  editTarget: string,
  apiKey: string,
): Promise<GeminiSegment[]> {
  const genAI = new GoogleGenAI({ apiKey });

  log.info(
    `[Segmentation] Sending request to Gemini model "${NAI_SEGMENTATION_MODEL}" (timeout: ${NAI_SEGMENTATION_TIMEOUT_MS}ms, image: ${Math.round((imageBase64.length * 0.75) / 1024)}KB, type: ${imageMimeType})`,
  );

  // Wrap the API call in a timeout because Gemini can hang indefinitely without one
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Gemini segmentation timed out after ${NAI_SEGMENTATION_TIMEOUT_MS}ms`)),
      NAI_SEGMENTATION_TIMEOUT_MS,
    ),
  );

  // Keep the prompt terse before the image with temperature 0.5 and thinking off so Gemini does not loop or stall.
  const apiCallPromise = genAI.models.generateContent({
    model: NAI_SEGMENTATION_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Give the segmentation masks for "${editTarget}" in this image. Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label". Use descriptive labels.`,
          },
          {
            inlineData: {
              mimeType: imageMimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ],
    config: omitGeminiSampling(NAI_SEGMENTATION_MODEL, {
      temperature: 0.5,
      safetySettings: SEGMENTATION_SAFETY_SETTINGS,
      thinkingConfig: buildGoogleThinkingConfig(NAI_SEGMENTATION_MODEL, "none"),
    }),
  });

  log.info("[Segmentation] Request sent, awaiting Gemini response...");

  const response = await Promise.race([apiCallPromise, timeoutPromise]);

  log.info(`[Segmentation] Gemini responded (raw response length: ${response.text?.length ?? 0} chars)`);

  const rawText = response.text?.trim() || "";

  if (!rawText) {
    throw new Error("Gemini segmentation returned empty response");
  }

  // Strip potential markdown fences that Gemini sometimes wraps around JSON output
  const responseText = rawText
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  let segments: GeminiSegment[];
  try {
    const parsed = JSON.parse(responseText);
    segments = Array.isArray(parsed) ? parsed : [parsed];
  } catch (parseErr) {
    log.error(`Failed to parse Gemini segmentation response: ${responseText.substring(0, 200)}`);
    throw new Error(`Failed to parse segmentation response: ${(parseErr as Error).message}`);
  }

  const validSegments = segments.filter((seg) => {
    if (!seg.box_2d || !Array.isArray(seg.box_2d) || seg.box_2d.length !== 4) {
      log.warn(`Skipping segment with invalid box_2d: ${JSON.stringify(seg.box_2d)}`);
      return false;
    }
    if (!seg.mask) {
      log.warn(`Skipping segment with missing mask (label: ${seg.label})`);
      return false;
    }
    return true;
  });

  if (validSegments.length === 0) {
    throw new Error(
      `Gemini found no valid segments for "${editTarget}". The model may not have detected the target in the image.`,
    );
  }

  log.info(
    `Gemini segmentation found ${validSegments.length} segment(s) for "${editTarget}": ${validSegments.map((s) => s.label).join(", ")}`,
  );

  return validSegments;
}

// Masks use ellipses quantized to 1/8th latent resolution in RGBA (alpha 255 redraw, 0 preserve) because NovelAI
// diffusion halos on unaligned or rectangular edges.
async function buildBoundingBoxMask(
  segments: GeminiSegment[],
  originalWidth: number,
  originalHeight: number,
  isV4: boolean,
): Promise<Buffer> {
  const svgEllipses: string[] = [];

  for (const segment of segments) {
    const [y0Norm, x0Norm, y1Norm, x1Norm] = segment.box_2d;

    let x0 = Math.round((x0Norm / 1000) * originalWidth);
    let y0 = Math.round((y0Norm / 1000) * originalHeight);
    let x1 = Math.round((x1Norm / 1000) * originalWidth);
    let y1 = Math.round((y1Norm / 1000) * originalHeight);

    const padX = Math.round((x1 - x0) * NAI_INPAINT_PADDING);
    const padY = Math.round((y1 - y0) * NAI_INPAINT_PADDING);
    x0 = Math.max(0, x0 - padX);
    y0 = Math.max(0, y0 - padY);
    x1 = Math.min(originalWidth, x1 + padX);
    y1 = Math.min(originalHeight, y1 + padY);

    const bboxWidth = Math.max(x1 - x0, 1);
    const bboxHeight = Math.max(y1 - y0, 1);

    const cx = x0 + bboxWidth / 2;
    const cy = y0 + bboxHeight / 2;
    const rx = bboxWidth / 2;
    const ry = bboxHeight / 2;

    log.info(
      `Mask region "${segment.label}": bbox [${x0},${y0}]-[${x1},${y1}] (${bboxWidth}x${bboxHeight}px, pad=${NAI_INPAINT_PADDING}) → ellipse cx=${Math.round(cx)},cy=${Math.round(cy)},rx=${Math.round(rx)},ry=${Math.round(ry)}`,
    );

    svgEllipses.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white"/>`);
  }

  if (svgEllipses.length === 0) {
    throw new Error("No valid bounding boxes to build mask from");
  }

  const svgMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${originalWidth}" height="${originalHeight}">` +
      `<rect width="100%" height="100%" fill="black"/>` +
      svgEllipses.join("") +
      `</svg>`,
  );

  let maskBuffer = await sharp(svgMask).resize(originalWidth, originalHeight).greyscale().toBuffer();

  // Nearest-neighbor quantize to 1/8th latent grid so NovelAI's internal downsampling cannot create boundary halos.
  const latentW = Math.ceil(originalWidth / 64) * 8;
  const latentH = Math.ceil(originalHeight / 64) * 8;

  maskBuffer = await sharp(maskBuffer).resize(latentW, latentH, { kernel: sharp.kernel.nearest }).toBuffer();

  // Upscale back to full resolution with nearest-neighbor because V4 models expect a blocky latent-aligned mask.
  if (isV4) {
    maskBuffer = await sharp(maskBuffer)
      .resize(latentW * 8, latentH * 8, { kernel: sharp.kernel.nearest })
      .toBuffer();
  }

  const { data, info } = await sharp(maskBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const isWhite = data[i] > 127 || data[i + 1] > 127 || data[i + 2] > 127;
    if (isWhite) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    } else {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }

  const finalMask = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();

  log.info(
    `Ellipse mask complete: ${info.width}x${info.height}px (latent grid: ${latentW}x${latentH}), ${svgEllipses.length} region(s), isV4=${isV4}, padding=${NAI_INPAINT_PADDING}`,
  );

  return finalMask;
}

const BBOX_COLORS = [
  "#FF0000",
  "#00FF00",
  "#0000FF",
  "#FFFF00",
  "#FF8800",
  "#FF69B4",
  "#800080",
  "#00FFFF",
  "#FF00FF",
  "#00FF88",
];

async function generateDebugOverlay(
  imageBuffer: Buffer,
  segments: GeminiSegment[],
  imgWidth: number,
  imgHeight: number,
): Promise<Buffer> {
  const svgElements: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const color = BBOX_COLORS[i % BBOX_COLORS.length];
    const [y0Norm, x0Norm, y1Norm, x1Norm] = segment.box_2d;

    const x0 = Math.round((x0Norm / 1000) * imgWidth);
    const y0 = Math.round((y0Norm / 1000) * imgHeight);
    const x1 = Math.round((x1Norm / 1000) * imgWidth);
    const y1 = Math.round((y1Norm / 1000) * imgHeight);
    const bboxWidth = Math.max(x1 - x0, 1);
    const bboxHeight = Math.max(y1 - y0, 1);

    svgElements.push(
      `<rect x="${x0}" y="${y0}" width="${bboxWidth}" height="${bboxHeight}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="6,4"/>`,
    );

    const padX = Math.round(bboxWidth * NAI_INPAINT_PADDING);
    const padY = Math.round(bboxHeight * NAI_INPAINT_PADDING);
    const px0 = Math.max(0, x0 - padX);
    const py0 = Math.max(0, y0 - padY);
    const px1 = Math.min(imgWidth, x1 + padX);
    const py1 = Math.min(imgHeight, y1 + padY);
    const paddedW = px1 - px0;
    const paddedH = py1 - py0;

    const cx = px0 + paddedW / 2;
    const cy = py0 + paddedH / 2;
    const rx = paddedW / 2;
    const ry = paddedH / 2;
    svgElements.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="2"/>`,
    );

    const label = segment.label || `Segment ${i + 1}`;
    const escapedLabel = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const labelY = Math.max(py0 - 4, 14);
    svgElements.push(
      `<text x="${px0 + 4}" y="${labelY}" font-size="14" font-family="sans-serif" fill="${color}" stroke="black" stroke-width="0.5">${escapedLabel}</text>`,
    );
  }

  const svgOverlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imgWidth}" height="${imgHeight}">${svgElements.join("")}</svg>`,
  );

  const overlayBuffer = await sharp(imageBuffer)
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return overlayBuffer;
}

export async function segmentImage(
  imageBase64: string,
  imageMimeType: string,
  editTarget: string,
  apiKey: string,
  isV4 = true,
): Promise<SegmentationResult> {
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const metadata = await sharp(imageBuffer).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to read source image dimensions for segmentation");
  }

  log.info(`Starting segmentation for "${editTarget}" on ${metadata.width}x${metadata.height} image`);

  const segments = await callGeminiSegmentation(imageBase64, imageMimeType, editTarget, apiKey);

  const maskBuffer = await buildBoundingBoxMask(segments, metadata.width, metadata.height, isV4);

  const maskBase64 = maskBuffer.toString("base64");

  let debugMaskBuffer: Buffer | undefined;
  let debugOverlayBuffer: Buffer | undefined;

  if (NAI_INPAINT_DEBUG) {
    debugMaskBuffer = maskBuffer;
    debugOverlayBuffer = await generateDebugOverlay(imageBuffer, segments, metadata.width, metadata.height);
    log.info("[Segmentation] Debug overlay with bounding boxes generated");
  }

  return {
    maskBase64,
    segmentCount: segments.length,
    labels: segments.map((s) => s.label),
    imageWidth: metadata.width,
    imageHeight: metadata.height,
    debugMaskBuffer,
    debugOverlayBuffer,
  };
}
