import type { CustomEndpointRow } from "@/types/db/schema";
import type {
  ProviderNativeImageGenerationRequest,
  ProviderNativeImageGenerationResult,
  ProviderNativeVideoGenerationRequest,
  ProviderNativeVideoGenerationResult,
} from "@/types/provider/featureInterfaces";
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { buildCustomHeaders } from "@/providers/custom/customOpenAICompatibleUtils";
import { log } from "@/utils/misc/logger";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";

type ComfyUiGenerationMode = "image" | "video";
type ComfyUiInpaintMaskContent = "fill" | "latent_noise";
type ComfyUiInpaintMode = "normal" | "extend" | "outpaint";
type ComfyUiOutpaintStrategy = "edge_extend" | "zoom_out" | "full_canvas";
type ComfyUiOutpaintAmount = "slight" | "moderate" | "large" | "dramatic";
type ComfyUiClothingSegmentCategory =
  | "Hat"
  | "Hair"
  | "Face"
  | "Sunglasses"
  | "Upper-clothes"
  | "Skirt"
  | "Dress"
  | "Belt"
  | "Pants"
  | "Left-arm"
  | "Right-arm"
  | "Left-leg"
  | "Right-leg"
  | "Bag"
  | "Scarf"
  | "Left-shoe"
  | "Right-shoe"
  | "Background";

interface ComfyUiReferenceImage {
  mimeType: string;
  data: string;
  url?: string;
}

interface ComfyUiGenerationOptions {
  mode: ComfyUiGenerationMode;
  prompt: string;
  aspectRatio?: string;
  durationSeconds?: number;
  resolution?: string;
  generateAudio?: boolean;
  referenceImages?: ComfyUiReferenceImage[];
  referenceImageDataUrl?: string | null;
  inpaint?: boolean;
  maskPrompt?: string | null;
  maskThreshold?: number | null;
  maskGrow?: number | null;
  maskFeather?: number | null;
  cfg?: number | null;
  denoise?: number | null;
  referenceDenoise?: number | null;
  seed?: number | null;
  inpaintMaskMode?: string | null;
  inpaintMode?: string | null;
  inpaintPreset?: string | null;
  outpaint?: boolean | null;
  outpaintStrategy?: string | null;
  outpaintAmount?: string | null;
  outpaintOverlap?: number | null;
  outpaintZoomScale?: number | null;
  inpaintExtendDirection?: string | null;
  inpaintExtendPixels?: number | null;
  inpaintExtendGrow?: number | null;
  inpaintExtendFeather?: number | null;
  inpaintExtendPadding?: number | null;
  clothingSegmentCategories?: string[] | null;
  disableClothingParser?: boolean;
}

type WorkflowPlaceholderValue = string | number | boolean | null | Record<string, unknown> | Array<unknown>;
type ComfyUiWorkflow = Record<string, unknown>;
type ComfyUiAsset = { filename: string; subfolder?: string; type?: string };
type ComfyUiGenerationResponse = { files: ComfyUiAsset[]; seed: number };
type ComfyUiWorkflowSupports = {
  txt2img: boolean;
  img2img: boolean;
  inpaint: boolean;
};
type RgbColor = { r: number; g: number; b: number };
type ComfyUiClothingSegmentSelection = Record<ComfyUiClothingSegmentCategory, boolean>;

const DEFAULT_COMFYUI_WORKFLOW_SUPPORTS: ComfyUiWorkflowSupports = {
  txt2img: true,
  img2img: true,
  inpaint: false,
};

type ComfyUiInpaintSettings = {
  maskThreshold: number;
  maskGrow: number;
  maskFeather: number;
  cfg: number;
  referenceDenoise: number;
  extendPixels: number;
  extendGrow: number;
  extendFeather: number;
  extendPadding: number;
};

type ComfyUiMaskProtectionSettings = {
  enabled: boolean;
  maskPrompt: string;
  maskThreshold: number;
  maskGrow: number;
  maskFeather: number;
  clothingMaskPrompt: string;
  clothingMaskThreshold: number;
  clothingMaskGrow: number;
  clothingMaskFeather: number;
  armsMaskPrompt: string;
  armsMaskThreshold: number;
  armsMaskGrow: number;
  armsMaskFeather: number;
  neckMaskPrompt: string;
  neckMaskThreshold: number;
  neckMaskGrow: number;
  neckMaskFeather: number;
  skinMaskPrompt: string;
  skinMaskThreshold: number;
  skinMaskGrow: number;
  skinMaskFeather: number;
  legsMaskPrompt: string;
  legsMaskThreshold: number;
  legsMaskGrow: number;
  legsMaskFeather: number;
  feetMaskPrompt: string;
  feetMaskThreshold: number;
  feetMaskGrow: number;
  feetMaskFeather: number;
};

const COMFYUI_IMAGE_TARGET_AREA = (() => {
  const parsed = Number.parseInt(process.env.COMFYUI_IMAGE_TARGET_AREA || "1048576", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024 * 1024;
})();
const COMFYUI_DIMENSION_MULTIPLE = 64;
const DEFAULT_COMFYUI_REFERENCE_DENOISE = 0.75;
const DEFAULT_COMFYUI_INPAINT_SETTINGS: ComfyUiInpaintSettings = {
  maskThreshold: 0.45,
  maskGrow: 8,
  maskFeather: 8,
  cfg: 10,
  referenceDenoise: 0.9,
  extendPixels: 96,
  extendGrow: 0,
  extendFeather: 4,
  extendPadding: 8,
};
const COMFYUI_INPAINT_PRESETS: Record<string, ComfyUiInpaintSettings> = {
  small_detail: {
    maskThreshold: 0.5,
    maskGrow: 4,
    maskFeather: 4,
    cfg: 8,
    referenceDenoise: 0.45,
    extendPixels: 64,
    extendGrow: 0,
    extendFeather: 4,
    extendPadding: 4,
  },
  tight_recolor: {
    maskThreshold: 0.5,
    maskGrow: 4,
    maskFeather: 3,
    cfg: 8,
    referenceDenoise: 0.5,
    extendPixels: 64,
    extendGrow: 0,
    extendFeather: 4,
    extendPadding: 4,
  },
  broad_recolor: {
    maskThreshold: 0.42,
    maskGrow: 12,
    maskFeather: 6,
    cfg: 9,
    referenceDenoise: 0.65,
    extendPixels: 128,
    extendGrow: 0,
    extendFeather: 6,
    extendPadding: 10,
  },
  background: {
    maskThreshold: 0.45,
    maskGrow: 2,
    maskFeather: 2,
    cfg: 12,
    referenceDenoise: 1,
    extendPixels: 96,
    extendGrow: 0,
    extendFeather: 4,
    extendPadding: 8,
  },
  extend: {
    maskThreshold: 0.4,
    maskGrow: 16,
    maskFeather: 12,
    cfg: 10,
    referenceDenoise: 0.9,
    extendPixels: 128,
    extendGrow: 8,
    extendFeather: 8,
    extendPadding: 12,
  },
};
const COMFYUI_MAX_RANDOM_SEED = 2 ** 32;
const COMFYUI_INPAINT_MASK_FILENAME_PREFIX = "tomoribot_inpaint_mask";
const COMFYUI_INPAINT_RESULT_DEBUG_FILENAME_PREFIX = "tomoribot_inpaint_result_debug";
const COMFYUI_OUTPAINT_INACTIVE_EXTEND_FACTOR = 0.01;
const COMFYUI_BASE_NEGATIVE_PROMPT =
  "low quality, worst quality, low detail, bad drawing, bad quality, oldest, (score_3, score_2, score_1:0.25), jpeg artifacts, watermark, signature, artist name, missing head, missing limb, bad anatomy, bad proportions, bad hands, missing fingers, spiral eyes, multiple views, duplicate face, extra face, second character, collage, inset image, tiny subject, distant subject, small subject, excessive empty space, subject too small";
const COMFYUI_CLOTHING_SEGMENT_CATEGORIES: ComfyUiClothingSegmentCategory[] = [
  "Hat",
  "Hair",
  "Face",
  "Sunglasses",
  "Upper-clothes",
  "Skirt",
  "Dress",
  "Belt",
  "Pants",
  "Left-arm",
  "Right-arm",
  "Left-leg",
  "Right-leg",
  "Bag",
  "Scarf",
  "Left-shoe",
  "Right-shoe",
  "Background",
];

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readOptionalNumberEnv(name: string): number | null {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === "") {
    return null;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOptionalStringEnv(name: string): string | null {
  const rawValue = process.env[name];
  const trimmed = rawValue?.trim();
  return trimmed ? trimmed : null;
}

function toUpperSnakeCase(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveComfyUiRuntimeWorkflowPath(endpoint: CustomEndpointRow): string | null {
  const extraConfigPath =
    isRecord(endpoint.extra_config) && typeof endpoint.extra_config.workflow_path === "string"
      ? endpoint.extra_config.workflow_path.trim()
      : "";
  if (extraConfigPath) {
    return extraConfigPath;
  }

  const labelToken = toUpperSnakeCase(endpoint.label ?? "");
  if (labelToken) {
    const labelScoped =
      readOptionalStringEnv(`COMFYUI_WORKFLOW_JSON_PATH_${labelToken}`) ??
      readOptionalStringEnv(`ANIMA3_COMFYUI_WORKFLOW_JSON_PATH_${labelToken}`);
    if (labelScoped) {
      return labelScoped;
    }
  }

  return (
    readOptionalStringEnv("COMFYUI_WORKFLOW_JSON_PATH") ?? readOptionalStringEnv("ANIMA3_COMFYUI_WORKFLOW_JSON_PATH")
  );
}

function loadComfyUiWorkflowFromPath(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    const raw = readFileSync(path, "utf8");
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to load ComfyUI workflow JSON from "${path}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(`ComfyUI workflow JSON at "${path}" must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function readOptionalBooleanEnv(name: string): boolean | null {
  const normalized = process.env[name]?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

function normalizeComfyUiInpaintMaskContent(value: string | null | undefined): ComfyUiInpaintMaskContent | null {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, "_") ?? "";
  if (normalized === "fill") {
    return "fill";
  }
  if (normalized === "latent_noise" || normalized === "latent" || normalized === "noise") {
    return "latent_noise";
  }
  return null;
}

function normalizeComfyUiInpaintPreset(preset: string | null | undefined): string | null {
  const normalized = preset?.trim().toLowerCase().replace(/[-\s]+/g, "_") ?? "";
  if (!normalized) {
    return null;
  }
  if (normalized in COMFYUI_INPAINT_PRESETS) {
    return normalized;
  }

  // Backward compatibility for older prompt/tool labels.
  if (normalized === "object_recolor" || normalized === "hair_recolor") {
    return "tight_recolor";
  }
  if (normalized === "garment_recolor") {
    return "broad_recolor";
  }

  return null;
}

function inferComfyUiInpaintPreset(options: ComfyUiGenerationOptions): string {
  const isHairRequest = isComfyUiHairMaskPrompt(options.maskPrompt) || /\b(?:hair|bangs|fringe|ponytail|braid|braids|pigtail|pigtails)\b/i.test(options.prompt);
  const explicitPreset = normalizeComfyUiInpaintPreset(options.inpaintPreset);
  if (explicitPreset) {
    if (isHairRequest && explicitPreset === "tight_recolor") {
      return "broad_recolor";
    }
    return explicitPreset;
  }

  const maskMode = normalizeComfyUiMaskMode(options.inpaintMaskMode);
  if (maskMode === "background") {
    return "background";
  }

  if (normalizeComfyUiInpaintMode(options) !== "normal") {
    return "extend";
  }

  const promptText = `${options.prompt} ${options.maskPrompt ?? ""}`.toLowerCase();
  if (
    /\b(?:dress|shirt|skirt|pants|coat|jacket|hoodie|cardigan|sweater|uniform|outfit|clothes|clothing|garment|apparel|fabric)\b/.test(
      promptText,
    )
  ) {
    return "broad_recolor";
  }
  if (/\b(?:hair|bangs|fringe|ponytail|braid|braids|pigtail|pigtails)\b/.test(promptText)) {
    return "broad_recolor";
  }
  if (/\b(?:color|colour|recolor|recolour|red|blue|green|yellow|pink|purple|black|white|brown|orange|cyan|teal)\b/.test(promptText)) {
    return "broad_recolor";
  }
  if (/\b(?:eye|eyes|button|buttons|logo|badge|gem|jewel|earring|ring|small|tiny)\b/.test(promptText)) {
    return "tight_recolor";
  }

  return "broad_recolor";
}

function isComfyUiEyeMaskPrompt(maskPrompt: string | null | undefined): boolean {
  return /\b(?:eye|eyes|iris|irises|pupil|pupils)\b/i.test(maskPrompt ?? "");
}

function isComfyUiHairMaskPrompt(maskPrompt: string | null | undefined): boolean {
  return /\b(?:hair|bangs|fringe|ponytail|braid|braids|pigtail|pigtails|hairstyle|locks|strands)\b/i.test(
    maskPrompt ?? "",
  );
}

function isComfyUiClothingMaskPrompt(maskPrompt: string | null | undefined): boolean {
  return /\b(?:shirt|top|hoodie|cardigan|sweater|jacket|coat|dress|skirt|pants|trousers|shorts|uniform|outfit|clothes|clothing|garment|apparel)\b/i.test(
    maskPrompt ?? "",
  );
}

function createComfyUiClothingSegmentSelection(
  enabledCategories: ComfyUiClothingSegmentCategory[],
): ComfyUiClothingSegmentSelection {
  return Object.fromEntries(
    COMFYUI_CLOTHING_SEGMENT_CATEGORIES.map((category) => [category, enabledCategories.includes(category)]),
  ) as ComfyUiClothingSegmentSelection;
}

function normalizeComfyUiClothingSegmentCategory(
  category: string | null | undefined,
): ComfyUiClothingSegmentCategory | null {
  const normalized = category?.trim().toLowerCase().replace(/[_\s]+/g, "-") ?? "";
  const categoryMap: Record<string, ComfyUiClothingSegmentCategory> = {
    hat: "Hat",
    hair: "Hair",
    face: "Face",
    sunglasses: "Sunglasses",
    glasses: "Sunglasses",
    "upper-clothes": "Upper-clothes",
    upper: "Upper-clothes",
    shirt: "Upper-clothes",
    top: "Upper-clothes",
    blouse: "Upper-clothes",
    hoodie: "Upper-clothes",
    sweater: "Upper-clothes",
    cardigan: "Upper-clothes",
    jacket: "Upper-clothes",
    coat: "Upper-clothes",
    skirt: "Skirt",
    dress: "Upper-clothes",
    belt: "Belt",
    pants: "Pants",
    trousers: "Pants",
    jeans: "Pants",
    leggings: "Pants",
    shorts: "Pants",
    "left-arm": "Left-arm",
    "right-arm": "Right-arm",
    "left-leg": "Left-leg",
    "right-leg": "Right-leg",
    bag: "Bag",
    scarf: "Scarf",
    "left-shoe": "Left-shoe",
    "right-shoe": "Right-shoe",
    shoes: "Left-shoe",
    background: "Background",
  };

  return categoryMap[normalized] ?? null;
}

function resolveComfyUiClothingSegmentCategories(
  options: ComfyUiGenerationOptions,
): ComfyUiClothingSegmentCategory[] {
  const explicitCategories = (options.clothingSegmentCategories ?? [])
    .map(normalizeComfyUiClothingSegmentCategory)
    .filter((category): category is ComfyUiClothingSegmentCategory => category !== null);
  if (explicitCategories.length > 0) {
    const categories = new Set(explicitCategories);
    if (categories.has("Left-shoe")) {
      categories.add("Right-shoe");
    }
    return [...categories];
  }

  const maskPrompt = options.maskPrompt?.toLowerCase() ?? "";
  const categories = new Set<ComfyUiClothingSegmentCategory>();
  const addUpperClothes = () => categories.add("Upper-clothes");
  const addBroadClothing = () => {
    ["Hat", "Sunglasses", "Upper-clothes", "Skirt", "Belt", "Pants", "Bag", "Scarf", "Left-shoe", "Right-shoe"].forEach(
      (category) => categories.add(category as ComfyUiClothingSegmentCategory),
    );
  };

  if (isComfyUiHairMaskPrompt(options.maskPrompt)) {
    addBroadClothing();
    return [...categories];
  }
  if (/\b(?:clothes|clothing|outfit|apparel|garment|uniform)\b/.test(maskPrompt)) {
    addBroadClothing();
  }
  if (/\b(?:shirt|top|blouse|camisole|tank\s*top|hoodie|cardigan|sweater|jacket|coat)\b/.test(maskPrompt)) {
    addUpperClothes();
  }
  if (/\bdress\b/.test(maskPrompt)) {
    categories.add("Upper-clothes");
  }
  if (/\bskirt\b/.test(maskPrompt)) {
    categories.add("Skirt");
  }
  if (/\b(?:pants|trousers|jeans|leggings|shorts)\b/.test(maskPrompt)) {
    categories.add("Pants");
  }
  if (/\bbelt\b/.test(maskPrompt)) {
    categories.add("Belt");
  }
  if (/\b(?:scarf|shawl)\b/.test(maskPrompt)) {
    categories.add("Scarf");
  }
  if (/\b(?:hat|cap|helmet)\b/.test(maskPrompt)) {
    categories.add("Hat");
  }
  if (/\b(?:sunglasses|glasses)\b/.test(maskPrompt)) {
    categories.add("Sunglasses");
  }
  if (/\b(?:bag|purse|backpack)\b/.test(maskPrompt)) {
    categories.add("Bag");
  }
  if (/\b(?:shoe|shoes|boot|boots|sneaker|sneakers)\b/.test(maskPrompt)) {
    categories.add("Left-shoe");
    categories.add("Right-shoe");
  }

  if (categories.size === 0) {
    addBroadClothing();
  }

  return [...categories];
}

function normalizeComfyUiTargetMaskPrompt(maskPrompt: string): string {
  const normalized = maskPrompt.trim();
  if (isComfyUiHairMaskPrompt(normalized)) {
    return "hair";
  }
  if (isComfyUiEyeMaskPrompt(normalized)) {
    return "both eyes";
  }
  return normalized;
}

function shouldSubtractComfyUiFaceMask(options: ComfyUiGenerationOptions): boolean {
  return (
    options.inpaint === true &&
    normalizeComfyUiMaskMode(options.inpaintMaskMode) === "target" &&
    normalizeComfyUiInpaintMode(options) === "normal" &&
    inferComfyUiInpaintPreset(options) !== "background" &&
    isComfyUiHairMaskPrompt(options.maskPrompt)
  );
}

function resolveComfyUiMaskProtectionSettings(options: ComfyUiGenerationOptions): ComfyUiMaskProtectionSettings {
  if (!shouldSubtractComfyUiFaceMask(options)) {
    return {
      enabled: false,
      maskPrompt: "",
      maskThreshold: 0,
      maskGrow: 0,
      maskFeather: 0,
      clothingMaskPrompt: "",
      clothingMaskThreshold: 0,
      clothingMaskGrow: 0,
      clothingMaskFeather: 0,
      armsMaskPrompt: "",
      armsMaskThreshold: 0,
      armsMaskGrow: 0,
      armsMaskFeather: 0,
      neckMaskPrompt: "",
      neckMaskThreshold: 0,
      neckMaskGrow: 0,
      neckMaskFeather: 0,
      skinMaskPrompt: "",
      skinMaskThreshold: 0,
      skinMaskGrow: 0,
      skinMaskFeather: 0,
      legsMaskPrompt: "",
      legsMaskThreshold: 0,
      legsMaskGrow: 0,
      legsMaskFeather: 0,
      feetMaskPrompt: "",
      feetMaskThreshold: 0,
      feetMaskGrow: 0,
      feetMaskFeather: 0,
    };
  }

  return {
    enabled: true,
    maskPrompt: "face",
    maskThreshold: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_FACE_MASK_THRESHOLD") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_FACE_MASK_THRESHOLD") ??
        0.42,
      0,
      1,
    ),
    maskGrow: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_FACE_MASK_GROW") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_FACE_MASK_GROW") ??
        2,
      0,
      128,
    ),
    maskFeather: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_FACE_MASK_FEATHER") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_FACE_MASK_FEATHER") ??
        1,
      0,
      100,
    ),
    clothingMaskPrompt:
      readOptionalStringEnv("COMFYUI_INPAINT_CLOTHING_MASK_PROMPT") ??
      readOptionalStringEnv("COMFYUI_INPAINT_BODY_MASK_PROMPT") ??
      readOptionalStringEnv("ANIMA3_INPAINT_CLOTHING_MASK_PROMPT") ??
      readOptionalStringEnv("ANIMA3_INPAINT_BODY_MASK_PROMPT") ??
      "clothes, dress, shirt, top, jacket, coat, hoodie, sweater, cardigan, skirt, pants, trousers, shorts, uniform",
    clothingMaskThreshold: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_CLOTHING_MASK_THRESHOLD") ??
        readOptionalNumberEnv("COMFYUI_INPAINT_BODY_MASK_THRESHOLD") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_CLOTHING_MASK_THRESHOLD") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_BODY_MASK_THRESHOLD") ??
        0.42,
      0,
      1,
    ),
    clothingMaskGrow: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_CLOTHING_MASK_GROW") ??
        readOptionalNumberEnv("COMFYUI_INPAINT_BODY_MASK_GROW") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_CLOTHING_MASK_GROW") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_BODY_MASK_GROW") ??
        12,
      0,
      128,
    ),
    clothingMaskFeather: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_CLOTHING_MASK_FEATHER") ??
        readOptionalNumberEnv("COMFYUI_INPAINT_BODY_MASK_FEATHER") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_CLOTHING_MASK_FEATHER") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_BODY_MASK_FEATHER") ??
        6,
      0,
      100,
    ),
    armsMaskPrompt:
      readOptionalStringEnv("COMFYUI_INPAINT_ARMS_MASK_PROMPT") ??
      readOptionalStringEnv("ANIMA3_INPAINT_ARMS_MASK_PROMPT") ??
      "arms",
    armsMaskThreshold: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_ARMS_MASK_THRESHOLD") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_ARMS_MASK_THRESHOLD") ??
        0.42,
      0,
      1,
    ),
    armsMaskGrow: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_ARMS_MASK_GROW") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_ARMS_MASK_GROW") ??
        2,
      0,
      128,
    ),
    armsMaskFeather: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_ARMS_MASK_FEATHER") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_ARMS_MASK_FEATHER") ??
        1,
      0,
      100,
    ),
    neckMaskPrompt:
      readOptionalStringEnv("COMFYUI_INPAINT_NECK_MASK_PROMPT") ??
      readOptionalStringEnv("ANIMA3_INPAINT_NECK_MASK_PROMPT") ??
      "neck",
    neckMaskThreshold: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_NECK_MASK_THRESHOLD") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_NECK_MASK_THRESHOLD") ??
        0.36,
      0,
      1,
    ),
    neckMaskGrow: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_NECK_MASK_GROW") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_NECK_MASK_GROW") ??
        4,
      0,
      128,
    ),
    neckMaskFeather: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_NECK_MASK_FEATHER") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_NECK_MASK_FEATHER") ??
        2,
      0,
      100,
    ),
    skinMaskPrompt:
      readOptionalStringEnv("COMFYUI_INPAINT_SKIN_MASK_PROMPT") ??
      readOptionalStringEnv("ANIMA3_INPAINT_SKIN_MASK_PROMPT") ??
      "shoulders",
    skinMaskThreshold: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_SKIN_MASK_THRESHOLD") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_SKIN_MASK_THRESHOLD") ??
        0.42,
      0,
      1,
    ),
    skinMaskGrow: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_SKIN_MASK_GROW") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_SKIN_MASK_GROW") ??
        1,
      0,
      128,
    ),
    skinMaskFeather: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_SKIN_MASK_FEATHER") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_SKIN_MASK_FEATHER") ??
        1,
      0,
      100,
    ),
    legsMaskPrompt:
      readOptionalStringEnv("COMFYUI_INPAINT_LEGS_MASK_PROMPT") ??
      readOptionalStringEnv("ANIMA3_INPAINT_LEGS_MASK_PROMPT") ??
      "legs",
    legsMaskThreshold: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_LEGS_MASK_THRESHOLD") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_LEGS_MASK_THRESHOLD") ??
        0.42,
      0,
      1,
    ),
    legsMaskGrow: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_LEGS_MASK_GROW") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_LEGS_MASK_GROW") ??
        1,
      0,
      128,
    ),
    legsMaskFeather: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_LEGS_MASK_FEATHER") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_LEGS_MASK_FEATHER") ??
        1,
      0,
      100,
    ),
    feetMaskPrompt:
      readOptionalStringEnv("COMFYUI_INPAINT_FEET_MASK_PROMPT") ??
      readOptionalStringEnv("ANIMA3_INPAINT_FEET_MASK_PROMPT") ??
      "feet",
    feetMaskThreshold: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_FEET_MASK_THRESHOLD") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_FEET_MASK_THRESHOLD") ??
        0.42,
      0,
      1,
    ),
    feetMaskGrow: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_FEET_MASK_GROW") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_FEET_MASK_GROW") ??
        1,
      0,
      128,
    ),
    feetMaskFeather: clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_FEET_MASK_FEATHER") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_FEET_MASK_FEATHER") ??
        1,
      0,
      100,
    ),
  };
}

function resolveComfyUiInpaintMaskContent(
  options: ComfyUiGenerationOptions,
  inpaint: boolean,
  maskMode: string,
): ComfyUiInpaintMaskContent {
  const requestedOverride = normalizeComfyUiInpaintMaskContent(
    readOptionalStringEnv("COMFYUI_INPAINT_MASK_CONTENT") ??
      readOptionalStringEnv("ANIMA3_INPAINT_MASK_CONTENT"),
  );
  const hairOverride = normalizeComfyUiInpaintMaskContent(
    readOptionalStringEnv("COMFYUI_HAIR_RECOLOR_MASK_CONTENT") ??
      readOptionalStringEnv("ANIMA3_HAIR_RECOLOR_MASK_CONTENT"),
  );
  const useHairRecolorContent =
    inpaint &&
    maskMode === "target" &&
    normalizeComfyUiInpaintMode(options) === "normal" &&
    inferComfyUiInpaintPreset(options) !== "background" &&
    isComfyUiHairMaskPrompt(options.maskPrompt);

  if (useHairRecolorContent) {
    return hairOverride ?? requestedOverride ?? "fill";
  }

  return requestedOverride ?? "fill";
}

function resolveComfyUiInpaintSettings(options: ComfyUiGenerationOptions): ComfyUiInpaintSettings {
  const inferredPreset = inferComfyUiInpaintPreset(options);
  const preset = COMFYUI_INPAINT_PRESETS[inferredPreset] ?? DEFAULT_COMFYUI_INPAINT_SETTINGS;
  const eyeMaskPrompt = isComfyUiEyeMaskPrompt(options.maskPrompt);
  const hairMaskPrompt = isComfyUiHairMaskPrompt(options.maskPrompt);
  const clothingMaskPrompt = isComfyUiClothingMaskPrompt(options.maskPrompt);
  const inpaintMode = normalizeComfyUiInpaintMode(options);

  const baseMaskThreshold = clampNumber(
    options.maskThreshold ??
      readOptionalNumberEnv("COMFYUI_INPAINT_MASK_THRESHOLD") ??
      readOptionalNumberEnv("ANIMA3_INPAINT_MASK_THRESHOLD") ??
      preset.maskThreshold,
    0,
    1,
  );
  const baseMaskGrow = clampNumber(
    options.maskGrow ??
      readOptionalNumberEnv("COMFYUI_INPAINT_MASK_GROW") ??
      readOptionalNumberEnv("ANIMA3_INPAINT_MASK_GROW") ??
      preset.maskGrow,
    0,
    128,
  );
  const baseMaskFeather = clampNumber(
    options.maskFeather ??
      readOptionalNumberEnv("COMFYUI_INPAINT_MASK_FEATHER") ??
      readOptionalNumberEnv("ANIMA3_INPAINT_MASK_FEATHER") ??
      preset.maskFeather,
    0,
    100,
  );

  // Eye edits often under-select only tiny iris fragments; widen just this case.
  const eyeMaskAdjustments =
    inferredPreset === "tight_recolor" && eyeMaskPrompt
      ? {
          maskThreshold: Math.min(baseMaskThreshold, 0.42),
          maskGrow: Math.max(baseMaskGrow, 8),
          maskFeather: Math.max(baseMaskFeather, 4),
        }
      : null;

  // Hair recolors were frequently too sparse or noisy. Give them a slightly
  // wider but still bounded detection profile.
  const hairRecolorAdjustments =
    inferredPreset !== "background" && hairMaskPrompt && inpaintMode !== "extend"
      ? {
          // Hair masks need to catch small strands; face subtraction handles
          // protecting nearby facial pixels in workflows that use the protection placeholders.
          maskThreshold: Math.min(baseMaskThreshold, 0.38),
          maskGrow: Math.max(baseMaskGrow, 9),
          maskFeather: Math.max(baseMaskFeather, 7),
          // Lower CFG reduces structural creativity; higher denoise strengthens recolor.
          cfg: 5,
          referenceDenoise: 0.84,
        }
      : null;

  const clothingRecolorAdjustments =
    inferredPreset === "broad_recolor" && clothingMaskPrompt && inpaintMode !== "extend"
      ? {
          // Match the known-good broad garment recolor profile.
          maskThreshold: Math.min(baseMaskThreshold, 0.42),
          maskGrow: Math.max(baseMaskGrow, 12),
          maskFeather: Math.max(baseMaskFeather, 6),
          // Slightly stronger color commitment without broad geometry drift.
          cfg: 8,
          referenceDenoise: 0.78,
        }
      : null;

  const broadStructureRecolorAdjustments =
    inferredPreset === "broad_recolor" && !clothingMaskPrompt && !hairMaskPrompt && inpaintMode !== "extend"
      ? {
          // Larger non-clothing masks need the source pose/scene to dominate;
          // crop-and-stitch keeps structure anchored, so denoise can carry the
          // visible color change while CFG stays moderate.
          cfg: 6,
          referenceDenoise: 0.68,
        }
      : null;

  // Hair extension should start from hair, not full-subject regions.
  const hairExtendAdjustments =
    inferredPreset === "extend" && hairMaskPrompt && inpaintMode === "extend"
      ? {
          maskThreshold: Math.max(baseMaskThreshold, 0.6),
          maskGrow: Math.min(baseMaskGrow, 0),
          maskFeather: Math.min(baseMaskFeather, 2),
          cfg: 9,
          referenceDenoise: 0.75,
          extendPixels: 64,
          extendGrow: 0,
          extendFeather: 2,
          extendPadding: 4,
        }
      : null;

  const maskThreshold =
    hairExtendAdjustments?.maskThreshold ??
    clothingRecolorAdjustments?.maskThreshold ??
    hairRecolorAdjustments?.maskThreshold ??
    eyeMaskAdjustments?.maskThreshold ??
    baseMaskThreshold;
  const maskGrow =
    hairExtendAdjustments?.maskGrow ??
    clothingRecolorAdjustments?.maskGrow ??
    hairRecolorAdjustments?.maskGrow ??
    eyeMaskAdjustments?.maskGrow ??
    baseMaskGrow;
  const maskFeather =
    hairExtendAdjustments?.maskFeather ??
    clothingRecolorAdjustments?.maskFeather ??
    hairRecolorAdjustments?.maskFeather ??
    eyeMaskAdjustments?.maskFeather ??
    baseMaskFeather;

  return {
    maskThreshold,
    maskGrow,
    maskFeather,
    cfg: clampNumber(
      hairExtendAdjustments?.cfg ??
        clothingRecolorAdjustments?.cfg ??
        broadStructureRecolorAdjustments?.cfg ??
        hairRecolorAdjustments?.cfg ??
        options.cfg ??
        readOptionalNumberEnv("COMFYUI_INPAINT_CFG") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_CFG") ??
        preset.cfg,
      0,
      30,
    ),
    referenceDenoise: clampNumber(
      hairExtendAdjustments?.referenceDenoise ??
        clothingRecolorAdjustments?.referenceDenoise ??
        broadStructureRecolorAdjustments?.referenceDenoise ??
        hairRecolorAdjustments?.referenceDenoise ??
        options.referenceDenoise ??
        options.denoise ??
        readOptionalNumberEnv("COMFYUI_INPAINT_DENOISE") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_DENOISE") ??
        preset.referenceDenoise,
      0,
      1,
    ),
    extendPixels: clampNumber(
      hairExtendAdjustments?.extendPixels ??
        options.inpaintExtendPixels ??
        readOptionalNumberEnv("COMFYUI_INPAINT_EXTEND_PIXELS") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_EXTEND_PIXELS") ??
        preset.extendPixels,
      0,
      512,
    ),
    extendGrow: clampNumber(
      hairExtendAdjustments?.extendGrow ??
        options.inpaintExtendGrow ??
        readOptionalNumberEnv("COMFYUI_INPAINT_EXTEND_GROW") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_EXTEND_GROW") ??
        preset.extendGrow,
      0,
      256,
    ),
    extendFeather: clampNumber(
      hairExtendAdjustments?.extendFeather ??
        options.inpaintExtendFeather ??
        readOptionalNumberEnv("COMFYUI_INPAINT_EXTEND_FEATHER") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_EXTEND_FEATHER") ??
        preset.extendFeather,
      0,
      100,
    ),
    extendPadding: clampNumber(
      hairExtendAdjustments?.extendPadding ??
        options.inpaintExtendPadding ??
        readOptionalNumberEnv("COMFYUI_INPAINT_EXTEND_PADDING") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_EXTEND_PADDING") ??
        preset.extendPadding,
      0,
      256,
    ),
  };
}

function normalizeComfyUiInpaintMode(
  modeOrOptions: string | null | undefined | Pick<ComfyUiGenerationOptions, "inpaintMode" | "outpaint">,
): ComfyUiInpaintMode {
  if (typeof modeOrOptions === "object" && modeOrOptions !== null) {
    if (modeOrOptions.outpaint === true) {
      return "outpaint";
    }
    return normalizeComfyUiInpaintMode(modeOrOptions.inpaintMode);
  }

  const normalized = modeOrOptions?.trim().toLowerCase() ?? "";
  if (normalized === "outpaint") {
    return "outpaint";
  }
  return normalized === "extend" ? "extend" : "normal";
}

function normalizeComfyUiMaskMode(mode: string | null | undefined): "target" | "background" {
  return mode?.trim().toLowerCase() === "background" ? "background" : "target";
}

function isComfyUiBackgroundMaskPrompt(maskPrompt: string): boolean {
  return /\b(?:background|backdrop|surroundings|environment|scene|setting)\b/i.test(maskPrompt);
}

function inferComfyUiForegroundMaskPrompt(prompt: string): string {
  const normalized = prompt.toLowerCase();
  const foregroundTerms: Array<[RegExp, string]> = [
    [/\b(?:lady|girl|woman|boy|man|person|character|anime\s+(?:lady|girl|woman|boy|man|character))\b/, "person"],
    [/\b(?:people|couple|friends|group|characters)\b/, "people"],
    [/\bapple\b/, "apple"],
    [/\b(?:cat|kitten)\b/, "cat"],
    [/\b(?:dog|puppy)\b/, "dog"],
    [/\b(?:bunny|rabbit)\b/, "rabbit"],
    [/\b(?:plush|plushie|stuffed animal|stuffed toy|toy)\b/, "toy"],
    [/\b(?:car|vehicle)\b/, "car"],
    [/\b(?:chair|bench|sofa|couch)\b/, "furniture"],
  ];

  for (const [pattern, maskPrompt] of foregroundTerms) {
    if (pattern.test(normalized)) {
      return maskPrompt;
    }
  }

  return "main foreground object";
}

function resolveComfyUiWorkflowMaskPrompt(
  maskPrompt: string,
  maskMode: "target" | "background",
  prompt: string,
): string {
  if (maskMode !== "background") {
    return normalizeComfyUiTargetMaskPrompt(maskPrompt);
  }

  // Generic background terms are poor detection targets for subject-preserving edits.
  // In those cases we detect the foreground subject and invert the mask downstream.
  if (isComfyUiBackgroundMaskPrompt(maskPrompt)) {
    return inferComfyUiForegroundMaskPrompt(prompt);
  }

  return maskPrompt;
}

function stripComfyUiHairRecolorPreservationClauses(prompt: string, maskPrompt: string | null | undefined): string {
  if (!isComfyUiHairMaskPrompt(maskPrompt)) {
    return prompt;
  }

  const hairShapeTerms =
    String.raw`(?:hair(?:style)?|haircut|braid|braids|bangs|fringe|parting|silhouette|shape|strand\s+layout)`;
  const optionalExisting = String.raw`(?:the\s+)?(?:existing\s+)?`;
  const joinedHairShapeTerms = String.raw`${optionalExisting}${hairShapeTerms}(?:\s+and\s+${optionalExisting}${hairShapeTerms})*`;
  const preserveClause = new RegExp(String.raw`\s*,?\s*(?:while\s+)?preserv(?:e|ing)\s+${joinedHairShapeTerms}\.?`, "gi");
  const keepClause = new RegExp(String.raw`\s*,?\s*(?:keep|keeping)\s+${joinedHairShapeTerms}\.?`, "gi");

  return prompt
    .replace(preserveClause, "")
    .replace(keepClause, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*$/, "")
    .trim();
}

function stripComfyUiNegativeInpaintClauses(prompt: string): string {
  return prompt
    .replace(/\s*,?\s*\b(?:not|no|without)\s+[^,.]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*$/, "")
    .trim();
}

function strengthenComfyUiHairRecolorPrompt(prompt: string, maskPrompt: string | null | undefined): string {
  if (!isComfyUiHairMaskPrompt(maskPrompt) || !/\b(?:color|colour|recolor|recolour|red|orange|yellow|green|blue|purple|pink|white|black|brown|blonde|grey|gray)\b/i.test(prompt)) {
    return prompt;
  }

  const shapeGuard =
    "hair dye only on existing source hair pixels, keep the exact original hair silhouette, length, part, bangs, volume, and strand layout, the masked region is hair only";

  if (/\b(?:dark|deep|near[-\s]?black|almost\s+black|blackish)\s+(?:purple|violet)\b|\b(?:purple|violet)\s+(?:near[-\s]?black|almost\s+black|blackish)\b/i.test(prompt)) {
    return `${prompt}, near-black deep purple hair dye across the entire masked hair, dark violet color from roots to tips, natural highlights and shadows, ${shapeGuard}`;
  }

  if (/\b(?:red[-\s]?orange|orange[-\s]?red|ginger|copper|auburn)\b/i.test(prompt)) {
    return `${prompt}, vivid red-orange hair dye, saturated red-orange hair color, red-orange tones throughout, natural highlights and shadows, ${shapeGuard}`;
  }

  if (/\bred\b/i.test(prompt)) {
    return `${prompt}, saturated true red hair dye across the entire masked hair, crimson red color from roots to tips, natural highlights and shadows, ${shapeGuard}`;
  }

  if (/\b(?:purple|violet)\b/i.test(prompt)) {
    return `${prompt}, saturated purple hair dye across the entire masked hair, purple color from roots to tips, natural highlights and shadows, ${shapeGuard}`;
  }

  return `${prompt}, strong visible color change across the entire masked hair, natural highlights and shadows, ${shapeGuard}`;
}

function normalizeComfyUiExtendDirection(direction: string | null | undefined): string {
  const normalized = direction?.trim().toLowerCase() || "down";
  return [
    "down",
    "up",
    "left",
    "right",
    "down_left",
    "down_right",
    "up_left",
    "up_right",
    "all",
  ].includes(normalized)
    ? normalized
    : "down";
}

function resolveComfyUiExtendOffset(direction: string, pixels: number): { x: number; y: number } {
  switch (direction) {
    case "up":
      return { x: 0, y: -pixels };
    case "left":
      return { x: -pixels, y: 0 };
    case "right":
      return { x: pixels, y: 0 };
    case "down_left":
      return { x: -pixels, y: pixels };
    case "down_right":
      return { x: pixels, y: pixels };
    case "up_left":
      return { x: -pixels, y: -pixels };
    case "up_right":
      return { x: pixels, y: -pixels };
    case "all":
      return { x: 0, y: 0 };
    case "down":
    default:
      return { x: 0, y: pixels };
  }
}

function isComfyUiOutpaint(options: Pick<ComfyUiGenerationOptions, "inpaintMode" | "outpaint">): boolean {
  return normalizeComfyUiInpaintMode(options) === "outpaint";
}

function normalizeComfyUiOutpaintAmount(value: string | null | undefined): ComfyUiOutpaintAmount | null {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, "_") ?? "";
  if (!normalized) {
    return null;
  }
  if (["slight", "small", "subtle", "little", "a_little", "tiny", "minimal"].includes(normalized)) {
    return "slight";
  }
  if (["moderate", "medium", "normal", "default", "regular"].includes(normalized)) {
    return "moderate";
  }
  if (["large", "wide", "strong", "more"].includes(normalized)) {
    return "large";
  }
  if (["dramatic", "very_large", "huge", "extreme", "maximum", "max"].includes(normalized)) {
    return "dramatic";
  }
  return null;
}

function inferComfyUiOutpaintAmount(prompt: string): ComfyUiOutpaintAmount | null {
  if (/\b(?:a little|little bit|slightly|slight|subtle|small amount|tiny bit|just a bit|zoom out a bit)\b/i.test(prompt)) {
    return "slight";
  }
  if (/\b(?:dramatic|huge|extreme|way out|far away|very wide|much wider|zoom way out)\b/i.test(prompt)) {
    return "dramatic";
  }
  if (
    /\b(?:large amount|zoom out more|much more|wider view|wide view|full[-\s]?body|full outfit|whole outfit|entire outfit|entire silhouette|head[-\s]?to[-\s]?toe|legs?|feet|lower body|lower half)\b/i.test(
      prompt,
    )
  ) {
    return "large";
  }
  return null;
}

function resolveComfyUiOutpaintAmount(options: ComfyUiGenerationOptions): ComfyUiOutpaintAmount {
  return (
    normalizeComfyUiOutpaintAmount(options.outpaintAmount) ??
    normalizeComfyUiOutpaintAmount(readOptionalStringEnv("COMFYUI_OUTPAINT_AMOUNT")) ??
    normalizeComfyUiOutpaintAmount(readOptionalStringEnv("ANIMA3_OUTPAINT_AMOUNT")) ??
    inferComfyUiOutpaintAmount(options.prompt) ??
    "moderate"
  );
}

function getComfyUiOutpaintAmountDefaults(amount: ComfyUiOutpaintAmount): { pixels: number; zoomScaleAll: number; zoomScaleOneSide: number } {
  switch (amount) {
    case "slight":
      return { pixels: 160, zoomScaleAll: 0.84, zoomScaleOneSide: 0.88 };
    case "large":
      return { pixels: 384, zoomScaleAll: 0.62, zoomScaleOneSide: 0.74 };
    case "dramatic":
      return { pixels: 512, zoomScaleAll: 0.54, zoomScaleOneSide: 0.66 };
    case "moderate":
    default:
      return { pixels: 256, zoomScaleAll: 0.74, zoomScaleOneSide: 0.82 };
  }
}

function resolveComfyUiOutpaintPixels(options: ComfyUiGenerationOptions): number {
  const amountDefaults = getComfyUiOutpaintAmountDefaults(resolveComfyUiOutpaintAmount(options));
  return clampNumber(
    options.inpaintExtendPixels ??
      readOptionalNumberEnv("COMFYUI_OUTPAINT_PIXELS") ??
      readOptionalNumberEnv("ANIMA3_OUTPAINT_PIXELS") ??
      amountDefaults.pixels,
    0,
    1024,
  );
}

function normalizeComfyUiOutpaintStrategy(value: string | null | undefined): ComfyUiOutpaintStrategy | null {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, "_") ?? "";
  if (!normalized) {
    return null;
  }
  if (["full_canvas", "canvas", "canvas_inpaint", "novelai", "novelai_style"].includes(normalized)) {
    return "full_canvas";
  }
  if (["zoom_out", "zoomout", "pull_back", "shrink", "reframe"].includes(normalized)) {
    return "zoom_out";
  }
  if (["edge_extend", "extend_edges", "pad", "padding", "crop_stitch", "crop_and_stitch"].includes(normalized)) {
    return "edge_extend";
  }
  return null;
}

function isComfyUiZoomOutPrompt(prompt: string): boolean {
  return /\b(?:zoom out|pull back|wider shot|wide shot|wide[-\s]?angle(?: shot)?|wide framing|wider view|wide view|more distant shot|full[-\s]?body|full outfit|whole outfit|entire outfit|entire silhouette)\b/i.test(
    prompt,
  );
}

function resolveComfyUiOutpaintStrategy(options: ComfyUiGenerationOptions): ComfyUiOutpaintStrategy {
  const direction = normalizeComfyUiExtendDirection(options.inpaintExtendDirection);
  const allDirectionOutpaint = direction === "all";
  const explicitStrategy = normalizeComfyUiOutpaintStrategy(options.outpaintStrategy);
  if (explicitStrategy) {
    if (explicitStrategy === "edge_extend" && allDirectionOutpaint) {
      return "full_canvas";
    }
    return explicitStrategy === "zoom_out" ? "full_canvas" : explicitStrategy;
  }

  const defaultStrategy = normalizeComfyUiOutpaintStrategy(
    readOptionalStringEnv("COMFYUI_OUTPAINT_STRATEGY") ?? readOptionalStringEnv("ANIMA3_OUTPAINT_STRATEGY"),
  );
  if (defaultStrategy) {
    if (defaultStrategy === "edge_extend" && allDirectionOutpaint) {
      return "full_canvas";
    }
    return defaultStrategy === "zoom_out" ? "full_canvas" : defaultStrategy;
  }

  if (allDirectionOutpaint || isComfyUiZoomOutPrompt(options.prompt)) {
    return "full_canvas";
  }

  return "edge_extend";
}

function resolveComfyUiOutpaintOverlap(options: ComfyUiGenerationOptions): number {
  return clampNumber(
    options.outpaintOverlap ??
      readOptionalNumberEnv("COMFYUI_OUTPAINT_OVERLAP") ??
      readOptionalNumberEnv("ANIMA3_OUTPAINT_OVERLAP") ??
      48,
    0,
    256,
  );
}

function resolveComfyUiOutpaintSubjectMaskGrow(): number {
  return clampNumber(
    readOptionalNumberEnv("COMFYUI_OUTPAINT_SUBJECT_MASK_GROW") ??
      readOptionalNumberEnv("ANIMA3_OUTPAINT_SUBJECT_MASK_GROW") ??
      2,
    0,
    64,
  );
}

function resolveComfyUiOutpaintSubjectMaskFeather(): number {
  return clampNumber(
    readOptionalNumberEnv("COMFYUI_OUTPAINT_SUBJECT_MASK_FEATHER") ??
      readOptionalNumberEnv("ANIMA3_OUTPAINT_SUBJECT_MASK_FEATHER") ??
      2,
    0,
    64,
  );
}

function resolveComfyUiOutpaintPadFeather(): number {
  return clampNumber(
    readOptionalNumberEnv("COMFYUI_OUTPAINT_PAD_FEATHER") ??
      readOptionalNumberEnv("ANIMA3_OUTPAINT_PAD_FEATHER") ??
      32,
    0,
    256,
  );
}

function resolveComfyUiOutpaintBlendFeather(): number {
  return clampNumber(
    readOptionalNumberEnv("COMFYUI_OUTPAINT_BLEND_FEATHER") ??
      readOptionalNumberEnv("ANIMA3_OUTPAINT_BLEND_FEATHER") ??
      12,
    0,
    64,
  );
}

function resolveComfyUiOutpaintCenterPreserveFeather(): number {
  return clampNumber(
    readOptionalNumberEnv("COMFYUI_OUTPAINT_CENTER_PRESERVE_FEATHER") ??
      readOptionalNumberEnv("ANIMA3_OUTPAINT_CENTER_PRESERVE_FEATHER") ??
      10,
    0,
    64,
  );
}

function resolveComfyUiOutpaintGuideBlurRadius(): number {
  return Math.round(
    clampNumber(
      readOptionalNumberEnv("COMFYUI_OUTPAINT_GUIDE_BLUR_RADIUS") ??
        readOptionalNumberEnv("ANIMA3_OUTPAINT_GUIDE_BLUR_RADIUS") ??
        24,
      1,
      31,
    ),
  );
}

function resolveComfyUiOutpaintGuideBlurSigma(): number {
  return clampNumber(
    readOptionalNumberEnv("COMFYUI_OUTPAINT_GUIDE_BLUR_SIGMA") ??
      readOptionalNumberEnv("ANIMA3_OUTPAINT_GUIDE_BLUR_SIGMA") ??
      6,
    0.1,
    10,
  );
}

function resolveComfyUiOutpaintDenoise(): number {
  return clampNumber(
    readOptionalNumberEnv("COMFYUI_OUTPAINT_DENOISE") ??
      readOptionalNumberEnv("ANIMA3_OUTPAINT_DENOISE") ??
      0.86,
    0.5,
    1,
  );
}

function resolveComfyUiOutpaintUnderpaintColor(): number {
  return Math.round(
    clampNumber(
      readOptionalNumberEnv("COMFYUI_OUTPAINT_UNDERPAINT_COLOR") ??
        readOptionalNumberEnv("ANIMA3_OUTPAINT_UNDERPAINT_COLOR") ??
        8421504,
      0,
      16777215,
    ),
  );
}

function resolveComfyUiOutpaintZoomScale(options: ComfyUiGenerationOptions, direction: string): number {
  const amountDefaults = getComfyUiOutpaintAmountDefaults(resolveComfyUiOutpaintAmount(options));
  const defaultScale = direction === "all" ? amountDefaults.zoomScaleAll : amountDefaults.zoomScaleOneSide;
  return clampNumber(
    options.outpaintZoomScale ??
      readOptionalNumberEnv("COMFYUI_OUTPAINT_ZOOM_SCALE") ??
      readOptionalNumberEnv("ANIMA3_OUTPAINT_ZOOM_SCALE") ??
      defaultScale,
    0.5,
    0.95,
  );
}

function shouldScaleComfyUiOutpaintSource(
  options: ComfyUiGenerationOptions,
  strategy: ComfyUiOutpaintStrategy,
  direction: string,
): boolean {
  if (strategy === "zoom_out") {
    return true;
  }
  if (strategy !== "full_canvas") {
    return false;
  }
  if (options.outpaintZoomScale !== null && options.outpaintZoomScale !== undefined) {
    return true;
  }
  const explicitStrategy = normalizeComfyUiOutpaintStrategy(options.outpaintStrategy);
  if (explicitStrategy === "zoom_out") {
    return true;
  }
  return normalizeComfyUiExtendDirection(direction) === "all" && isComfyUiZoomOutPrompt(options.prompt);
}

function getComfyUiDirectionalOutpaintFactors(direction: string): {
  up: number;
  down: number;
  left: number;
  right: number;
} {
  return {
    up: direction === "up" || direction === "up_left" || direction === "up_right" || direction === "all" ? 1 : 0,
    down: direction === "down" || direction === "down_left" || direction === "down_right" || direction === "all" ? 1 : 0,
    left: direction === "left" || direction === "down_left" || direction === "up_left" || direction === "all" ? 1 : 0,
    right: direction === "right" || direction === "down_right" || direction === "up_right" || direction === "all" ? 1 : 0,
  };
}

function getComfyUiWorkflowOutpaintFactors(
  direction: string,
  outpaint: boolean,
): {
  up: number;
  down: number;
  left: number;
  right: number;
} {
  const factors = getComfyUiDirectionalOutpaintFactors(direction);
  return {
    up: outpaint && factors.up > 0 ? factors.up : COMFYUI_OUTPAINT_INACTIVE_EXTEND_FACTOR,
    down: outpaint && factors.down > 0 ? factors.down : COMFYUI_OUTPAINT_INACTIVE_EXTEND_FACTOR,
    left: outpaint && factors.left > 0 ? factors.left : COMFYUI_OUTPAINT_INACTIVE_EXTEND_FACTOR,
    right: outpaint && factors.right > 0 ? factors.right : COMFYUI_OUTPAINT_INACTIVE_EXTEND_FACTOR,
  };
}

function getComfyUiLayoutOutpaintFactors(
  layout: ComfyUiOutpaintLayout | null,
  outputDimensions: { width: number; height: number },
  fallbackDirection: string,
  outpaint: boolean,
  outpaintPixels: number,
): {
  up: number;
  down: number;
  left: number;
  right: number;
} {
  if (!layout || layout.sourceScale >= 1 || !outpaint || outpaintPixels <= 0) {
    return getComfyUiWorkflowOutpaintFactors(fallbackDirection, outpaint);
  }

  const leftPad = layout.placedSourceX;
  const topPad = layout.placedSourceY;
  const rightPad = outputDimensions.width - layout.placedSourceX - layout.placedSourceWidth;
  const bottomPad = outputDimensions.height - layout.placedSourceY - layout.placedSourceHeight;
  const toFactor = (pixels: number): number =>
    pixels > 0 ? Math.max(COMFYUI_OUTPAINT_INACTIVE_EXTEND_FACTOR, pixels / outpaintPixels) : COMFYUI_OUTPAINT_INACTIVE_EXTEND_FACTOR;

  return {
    up: toFactor(topPad),
    down: toFactor(bottomPad),
    left: toFactor(leftPad),
    right: toFactor(rightPad),
  };
}

function buildComfyUiOutpaintDimensions(
  options: ComfyUiGenerationOptions,
  sourceDimensions: { width: number; height: number },
  direction: string,
  pixels: number,
): { width: number; height: number } {
  const strategy = resolveComfyUiOutpaintStrategy(options);
  const factors = getComfyUiDirectionalOutpaintFactors(direction);
  if (shouldScaleComfyUiOutpaintSource(options, strategy, direction)) {
    const sourceScale = resolveComfyUiOutpaintZoomScale(options, direction);
    return {
      width:
        factors.left > 0 || factors.right > 0
          ? roundToNearestMultiple(sourceDimensions.width / sourceScale, COMFYUI_DIMENSION_MULTIPLE)
          : sourceDimensions.width,
      height:
        factors.up > 0 || factors.down > 0
          ? roundToNearestMultiple(sourceDimensions.height / sourceScale, COMFYUI_DIMENSION_MULTIPLE)
          : sourceDimensions.height,
    };
  }
  return {
    width: roundToNearestMultiple(
      sourceDimensions.width + pixels * factors.left + pixels * factors.right,
      COMFYUI_DIMENSION_MULTIPLE,
    ),
    height: roundToNearestMultiple(
      sourceDimensions.height + pixels * factors.up + pixels * factors.down,
      COMFYUI_DIMENSION_MULTIPLE,
    ),
  };
}

type ComfyUiOutpaintLayout = {
  strategy: ComfyUiOutpaintStrategy;
  sourceScale: number;
  overlap: number;
  placedSourceX: number;
  placedSourceY: number;
  placedSourceWidth: number;
  placedSourceHeight: number;
  maskSourceX: number;
  maskSourceY: number;
  maskSourceWidth: number;
  maskSourceHeight: number;
};

function resolveComfyUiOutpaintAxisPlacement(
  outputSize: number,
  placedSize: number,
  extendStart: boolean,
  extendEnd: boolean,
): number {
  if (extendStart && !extendEnd) {
    return outputSize - placedSize;
  }
  if (extendEnd && !extendStart) {
    return 0;
  }
  return Math.max(0, Math.floor((outputSize - placedSize) / 2));
}

function buildComfyUiOutpaintLayout(
  options: ComfyUiGenerationOptions,
  sourceDimensions: { width: number; height: number },
  outputDimensions: { width: number; height: number },
  direction: string,
): ComfyUiOutpaintLayout {
  const strategy = resolveComfyUiOutpaintStrategy(options);
  const factors = getComfyUiDirectionalOutpaintFactors(direction);
  const scaleSource = shouldScaleComfyUiOutpaintSource(options, strategy, direction);
  const sourceScale = scaleSource ? resolveComfyUiOutpaintZoomScale(options, direction) : 1;
  const placedSourceWidth = sourceDimensions.width;
  const placedSourceHeight = sourceDimensions.height;
  const placedSourceX =
    scaleSource
      ? resolveComfyUiOutpaintAxisPlacement(outputDimensions.width, placedSourceWidth, factors.left > 0, factors.right > 0)
      : factors.left > 0
        ? Math.max(0, outputDimensions.width - sourceDimensions.width - factors.right * resolveComfyUiOutpaintPixels(options))
        : 0;
  const placedSourceY =
    scaleSource
      ? resolveComfyUiOutpaintAxisPlacement(outputDimensions.height, placedSourceHeight, factors.up > 0, factors.down > 0)
      : factors.up > 0
        ? Math.max(0, outputDimensions.height - sourceDimensions.height - factors.down * resolveComfyUiOutpaintPixels(options))
        : 0;
  const rawOverlap = resolveComfyUiOutpaintOverlap(options);
  const zoomOutOverlapCap = clampNumber(
    readOptionalNumberEnv("COMFYUI_OUTPAINT_ZOOM_MAX_OVERLAP") ?? readOptionalNumberEnv("ANIMA3_OUTPAINT_ZOOM_MAX_OVERLAP") ?? 48,
    0,
    96,
  );
  const overlap = Math.min(rawOverlap, Math.floor(Math.min(placedSourceWidth, placedSourceHeight) / 3));
  const effectiveOverlap = scaleSource ? Math.min(overlap, zoomOutOverlapCap) : overlap;
  const leftPad = placedSourceX;
  const topPad = placedSourceY;
  const rightPad = outputDimensions.width - placedSourceX - placedSourceWidth;
  const bottomPad = outputDimensions.height - placedSourceY - placedSourceHeight;
  const maskInsetLeft = leftPad > 0 ? effectiveOverlap : 0;
  const maskInsetTop = topPad > 0 ? effectiveOverlap : 0;
  const maskInsetRight = rightPad > 0 ? effectiveOverlap : 0;
  const maskInsetBottom = bottomPad > 0 ? effectiveOverlap : 0;
  const maskSourceX = placedSourceX + maskInsetLeft;
  const maskSourceY = placedSourceY + maskInsetTop;
  const maskSourceWidth = Math.max(1, placedSourceWidth - maskInsetLeft - maskInsetRight);
  const maskSourceHeight = Math.max(1, placedSourceHeight - maskInsetTop - maskInsetBottom);

  return {
    strategy,
    sourceScale,
    overlap: effectiveOverlap,
    placedSourceX,
    placedSourceY,
    placedSourceWidth,
    placedSourceHeight,
    maskSourceX,
    maskSourceY,
    maskSourceWidth,
    maskSourceHeight,
  };
}

function buildComfyUiOutpaintDirectionPrompt(direction: string, scaleSource = false): string[] {
  const normalizedDirection = normalizeComfyUiExtendDirection(direction);
  if (normalizedDirection.startsWith("down")) {
    return [
      "the newly added canvas is below the original bottom edge",
      "continue bottom-edge content downward from the existing crop",
      "if clothing, legs, feet, floor, or ground are cropped at the bottom edge, extend those lower-body and ground details naturally below the original image",
      "do not fill a downward extension mainly with sky, clouds, or unrelated scenery unless those elements already touch the bottom edge",
    ];
  }
  if (normalizedDirection.startsWith("up")) {
    return [
      "the newly added canvas is above the original top edge",
      "continue top-edge content upward from the existing crop",
      "if sky, ceiling, hair, headwear, or headroom are cropped at the top edge, extend those details naturally above the original image",
    ];
  }
  if (normalizedDirection === "left" || normalizedDirection === "right") {
    return [
      `the newly added canvas is on the ${normalizedDirection} side of the original image`,
      `continue ${normalizedDirection}-edge content outward from the existing crop`,
    ];
  }
  return [
    scaleSource
      ? "treat all-direction zoom-out outpainting as a wider view around the scaled source image, not as a full redraw"
      : "treat all-direction outpainting as a border expansion around the fixed source image, not as a full redraw or subject rescale",
    "continue each original edge outward only from content that touches that edge",
  ];
}

function buildComfyUiPromptWithDefaults(
  options: ComfyUiGenerationOptions,
  inpaint: boolean,
  maskMode: string,
  invertMask: boolean,
  hasReference: boolean,
): string {
  const prompt = options.prompt.trim();
  const qualityPrefix = "masterpiece, best quality, newest, (score_9, score_8, score_7:0.25)";
  if (hasReference && !inpaint) {
    return [
      qualityPrefix,
      `reference-inspired image generation: ${prompt}`,
      "use the reference image as loose visual inspiration for subject, composition, palette, or style",
      "create a new similar image with the requested changes clearly visible",
      "do not copy the reference exactly, allow meaningful variation while preserving the user's requested intent",
    ].join(", ");
  }

  if (!inpaint) {
    return `${qualityPrefix}, well-composed, main subject clearly visible, ${prompt}`;
  }

  const maskPrompt = options.maskPrompt?.trim() || "masked region";
  if (isComfyUiOutpaint(options)) {
    const normalizedDirection = normalizeComfyUiExtendDirection(options.inpaintExtendDirection);
    const outpaintStrategy = resolveComfyUiOutpaintStrategy(options);
    const scaleSource = shouldScaleComfyUiOutpaintSource(options, outpaintStrategy, normalizedDirection);
    const direction = normalizedDirection.replaceAll("_", " ");
    return [
      qualityPrefix,
      `canvas outpainting edit: ${prompt}`,
      `extend the image ${direction} beyond the original canvas`,
      ...(outpaintStrategy === "full_canvas"
        ? scaleSource
          ? [
              "zoom-out full-canvas outpainting: place the original image smaller inside a larger canvas",
              "preserve the main source subject and central composition without preserving the old image rectangle as a panel",
              "continue the visible background beyond the original image edges instead of replacing the original setting",
              "fill the padded canvas as one coherent pulled-back view that matches the original background mood, lighting, palette, and style",
            ]
          : [
              "full-canvas outpainting: place the original image unchanged on a larger canvas",
              "mask only the newly revealed canvas area plus a small edge overlap",
              "fill the masked expanded canvas as one coherent image, then preserve the original source area",
            ]
        : outpaintStrategy === "zoom_out"
        ? [
            "zoom-out outpainting: the original image is placed smaller inside a larger canvas",
            "fill the newly revealed surrounding canvas around the scaled source image",
            "keep the scaled source image as the composition anchor and complete missing nearby context around it",
          ]
        : ["edge-extension outpainting: keep the original source scale and continue only beyond the original edges"]),
      ...buildComfyUiOutpaintDirectionPrompt(normalizedDirection, scaleSource),
      "continue the visible background, lighting, perspective, and environment naturally into the newly added canvas area",
      ...(scaleSource
        ? [
            "continue any recognizable source setting elements visible in the original image instead of replacing the setting with a new motif",
            "continue cropped clothing, limbs, or lower-body details only as far as the expanded canvas naturally allows",
            "do not compress anatomy, create tiny limbs, or add a separate small body to force a full-body view",
            "keep only the foreground subject or subjects already present in the source image or explicitly requested by the user",
            "treat ambiguous shapes behind the foreground subject or subjects as background texture, not as an extra person or creature",
            "the area around and behind the subject should look like one continuous scene, not a pasted image frame",
            "do not create a square backdrop, inset panel, visible source rectangle, poster border, duplicate subject, or unrelated foreground objects",
          ]
        : []),
      "only continue the existing subject where it is visibly cropped by the original image edge",
      "most added canvas should be surrounding scene, not new character anatomy",
      scaleSource ? "preserve the main foreground subject exactly in place" : "preserve the original source image area exactly in place",
      "match the original lighting, perspective, camera angle, line style, color palette, and texture",
      "do not create a duplicate character, second face, giant face, giant torso, giant limb, or unrelated character body parts in the added border",
      "no frame, no border, no blank padding, no duplicated edge pattern",
      "the new content should connect seamlessly to the existing image edge",
    ].join(", ");
  }

  if (maskMode === "background") {
    const protectedRegion = invertMask ? maskPrompt : "main foreground subject";
    const editableRegion = invertMask
      ? `the surroundings outside the protected ${maskPrompt}`
      : "the detected background/surroundings region";
    return [
      qualityPrefix,
      `surroundings-only inpainting edit: ${prompt}`,
      "replace the editable surroundings with the requested background, environment, location, atmosphere, or setting",
      "the new surroundings must fill the entire editable canvas edge to edge, all the way to every image border",
      `apply the requested scene change only to ${editableRegion}`,
      `keep the protected ${protectedRegion} unchanged, same shape, color, lighting, position, and style`,
      "flat continuous background behind the protected subject, clean edge transition",
      "no halo, no outline, no glow, no bubble, no glass dome, no capsule, no transparent shell, no reflection around or over the protected subject",
      "no inset panel or framed rectangle",
    ].join(", ");
  }

  return [
    qualityPrefix,
    `localized inpainting edit for the masked ${maskPrompt}: ${prompt}`,
    "change only the masked area",
    "recolor-only edit when changing colors or materials",
    "use the source image as the structure guide",
    ...(isComfyUiHairMaskPrompt(options.maskPrompt)
      ? [
          "for hair recolors, change pigment only and keep the source hairstyle geometry unchanged",
          "treat the editable mask as hair strands only, not clothing, shoulders, arms, neck, skin, or anatomy",
        ]
      : []),
    "keep clothing and accessories from the source image unchanged",
    "keep all unmasked regions exactly as in the source image",
    "if the user prompt mentions full-scene or full-character details, treat those as style hints for the masked area only",
    "preserve the unmasked image exactly, same lighting and style",
  ].join(", ");
}

function extractNegatedPromptTerms(prompt: string): string[] {
  const colorTerms = [
    "white",
    "blue",
    "cyan",
    "teal",
    "green",
    "yellow",
    "orange",
    "red",
    "pink",
    "purple",
    "violet",
    "brown",
    "black",
    "gray",
    "grey",
    "beige",
  ];
  const settingTerms = [
    "indoor",
    "indoors",
    "outdoor",
    "outdoors",
    "interior",
    "exterior",
    "room",
    "studio",
    "plain",
    "empty",
    "blank",
  ];
  const terms = [...colorTerms, ...settingTerms];
  const negatedClauses = [...prompt.matchAll(/\b(?:not|no|without)\s+([^,.]+)/gi)].map((match) =>
    match[1]?.toLowerCase() ?? "",
  );
  const negatedTerms = new Set<string>();
  for (const clause of negatedClauses) {
    for (const term of terms) {
      if (new RegExp(`\\b${term}\\b`, "i").test(clause)) {
        negatedTerms.add(term);
      }
    }
  }
  return [...negatedTerms];
}

function buildComfyUiNegativePrompt(options: ComfyUiGenerationOptions, inpaint: boolean, maskMode: string): string {
  if (!inpaint) {
    return COMFYUI_BASE_NEGATIVE_PROMPT;
  }

  const negativeParts = [COMFYUI_BASE_NEGATIVE_PROMPT, "unrequested changes, changed unmasked area"];
  if (isComfyUiOutpaint(options)) {
    negativeParts.push(
      "moved original image",
      "resized original image content",
      "cropped original image content",
      "changed original source area",
      "visible seam",
      "hard border",
      "dark outer frame",
      "black outer border",
      "matte border",
      "vignette frame",
      "blank padding",
      "empty extension",
      "mirrored edge",
      "repeated edge artifacts",
      "duplicate character",
      "second character",
      "extra face",
      "giant face",
      "giant torso",
      "giant body",
      "giant limb",
      "unrelated body parts",
      "new character in border",
      "unrequested character behind subject",
      "unrequested person behind subject",
      "unrequested creature behind subject",
      "unrequested background character",
      "unrequested partial body behind subject",
      "unrequested face in background",
      "unrequested body silhouette in background",
      "cropped duplicate person",
    );
    return negativeParts.join(", ");
  }

  if (maskMode === "background") {
    negativeParts.push(
      "changed protected foreground subject",
      "altered protected subject color",
      "altered protected subject shape",
      "halo around protected subject",
      "glow around protected subject",
      "bubble around protected subject",
      "glass dome around protected subject",
      "transparent shell around protected subject",
      "capsule around protected subject",
      "reflection over protected subject",
      "specular highlight over protected subject",
      "outline around protected subject",
      "old background, original background, unchanged background",
      "centered background panel",
      "inset rectangle",
      "framed rectangle",
      "picture frame",
      "border around background",
      "margin around background",
      "blank outer area",
      "empty outer area",
      "background only behind subject",
    );

    for (const term of extractNegatedPromptTerms(options.prompt)) {
      negativeParts.push(`${term} background`, `${term} backdrop`, `${term} environment`, `${term} setting`);
    }
  } else {
    negativeParts.push(
      "garment redesign",
      "different clothing type",
      "changed neckline",
      "changed sleeves",
      "changed hem",
      "changed fit",
      "new accessories",
      "removed accessories",
      "changed body anatomy",
      "changed pose",
      "changed face",
      "new pattern not requested",
      "logo added",
      "text added",
    );
  }

  return negativeParts.join(", ");
}

function resolveComfyUiDenoise(options: ComfyUiGenerationOptions): number {
  if (!buildReferenceImageDataUrl(options)) {
    return 1;
  }

  const rawDenoise = options.denoise ?? options.referenceDenoise ?? null;
  if (rawDenoise !== null) {
    return Number.isFinite(rawDenoise) ? clampNumber(rawDenoise, 0, 1) : DEFAULT_COMFYUI_REFERENCE_DENOISE;
  }

  if (options.inpaint === true) {
    return resolveComfyUiInpaintSettings(options).referenceDenoise;
  }

  const envDenoise = readOptionalNumberEnv("COMFYUI_REFERENCE_DENOISE");
  if (envDenoise !== null) {
    return clampNumber(envDenoise, 0, 1);
  }

  const img2imgDenoise =
    readOptionalNumberEnv("COMFYUI_IMG2IMG_DENOISE") ?? readOptionalNumberEnv("ANIMA3_IMG2IMG_DENOISE");
  if (img2imgDenoise !== null) {
    return clampNumber(img2imgDenoise, 0, 1);
  }

  return DEFAULT_COMFYUI_REFERENCE_DENOISE;
}

function resolveComfyUiEffectiveDenoise(options: ComfyUiGenerationOptions, inpaint: boolean, maskMode: string): number {
  const denoise = resolveComfyUiDenoise(options);
  if (!inpaint || maskMode !== "background") {
    return denoise;
  }

  const backgroundMinDenoise = clampNumber(
    readOptionalNumberEnv("COMFYUI_BACKGROUND_INPAINT_MIN_DENOISE") ??
      readOptionalNumberEnv("ANIMA3_BACKGROUND_INPAINT_MIN_DENOISE") ??
      1,
    0,
    1,
  );
  return Math.max(denoise, backgroundMinDenoise);
}

function resolveComfyUiEffectiveInpaintSettings(
  settings: ComfyUiInpaintSettings,
  inpaint: boolean,
  maskMode: "target" | "background",
): ComfyUiInpaintSettings {
  if (!inpaint || maskMode !== "background") {
    return settings;
  }

  // Background edits are prone to halo/shell artifacts when the editable area bleeds
  // into the protected subject edge. Keep this path crisp and minimally expanded.
  return {
    ...settings,
    maskThreshold: Math.min(settings.maskThreshold, 0.4),
    maskGrow: 0,
    maskFeather: 0,
  };
}

function getComfyUiTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.COMFYUI_POLL_TIMEOUT_MS ?? "300000", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300000;
}

function generateComfyUiSeed(): number {
  return randomInt(0, COMFYUI_MAX_RANDOM_SEED);
}

function parseAspectRatio(
  aspectRatio: string | undefined,
  fallback: string,
): { widthUnits: number; heightUnits: number } {
  const normalized = aspectRatio?.trim() || fallback;
  const match = normalized.match(/^(\d+):(\d+)$/);
  if (!match) {
    return fallback === normalized ? { widthUnits: 1, heightUnits: 1 } : parseAspectRatio(fallback, fallback);
  }

  const widthUnits = Number.parseInt(match[1], 10);
  const heightUnits = Number.parseInt(match[2], 10);
  if (!Number.isFinite(widthUnits) || !Number.isFinite(heightUnits) || widthUnits <= 0 || heightUnits <= 0) {
    return fallback === normalized ? { widthUnits: 1, heightUnits: 1 } : parseAspectRatio(fallback, fallback);
  }

  return { widthUnits, heightUnits };
}

function roundToNearestMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function buildComfyUiImageDimensions(aspectRatio: string | undefined): { width: number; height: number } {
  const { widthUnits, heightUnits } = parseAspectRatio(aspectRatio, "1:1");
  const width = Math.sqrt((COMFYUI_IMAGE_TARGET_AREA * widthUnits) / heightUnits);
  const height = Math.sqrt((COMFYUI_IMAGE_TARGET_AREA * heightUnits) / widthUnits);

  return {
    width: roundToNearestMultiple(width, COMFYUI_DIMENSION_MULTIPLE),
    height: roundToNearestMultiple(height, COMFYUI_DIMENSION_MULTIPLE),
  };
}

function buildComfyUiVideoDimensions(
  aspectRatio: string | undefined,
  resolution: string | undefined,
): {
  width: number;
  height: number;
} {
  const normalizedResolution = resolution === "1080p" ? "1080p" : resolution === "720p" ? "720p" : "480p";
  const normalizedAspectRatio = aspectRatio === "9:16" || aspectRatio === "1:1" ? aspectRatio : "16:9";

  if (normalizedAspectRatio === "9:16") {
    if (normalizedResolution === "1080p") {
      return { width: 1080, height: 1920 };
    }
    if (normalizedResolution === "720p") {
      return { width: 720, height: 1280 };
    }
    return { width: 480, height: 854 };
  }

  if (normalizedAspectRatio === "1:1") {
    if (normalizedResolution === "1080p") {
      return { width: 1024, height: 1024 };
    }
    if (normalizedResolution === "720p") {
      return { width: 720, height: 720 };
    }
    return { width: 480, height: 480 };
  }

  if (normalizedResolution === "1080p") {
    return { width: 1920, height: 1080 };
  }
  if (normalizedResolution === "720p") {
    return { width: 1280, height: 720 };
  }
  return { width: 854, height: 480 };
}

function buildComfyUiDimensions(options: ComfyUiGenerationOptions): { width: number; height: number } {
  return options.mode === "video"
    ? buildComfyUiVideoDimensions(options.aspectRatio, options.resolution)
    : buildComfyUiImageDimensions(options.aspectRatio);
}

function buildComfyUiReferencePayload(referenceImages: ComfyUiReferenceImage[]): Array<Record<string, unknown>> {
  return referenceImages.map((referenceImage, index) => ({
    index: index + 1,
    mimeType: referenceImage.mimeType,
    data: referenceImage.data,
    dataUrl: `data:${referenceImage.mimeType};base64,${referenceImage.data}`,
    ...(referenceImage.url ? { url: referenceImage.url } : {}),
  }));
}

function isComfyUiInpaintMaskAsset(asset: ComfyUiAsset): boolean {
  return asset.filename.toLowerCase().startsWith(COMFYUI_INPAINT_MASK_FILENAME_PREFIX);
}

function isComfyUiInpaintResultDebugAsset(asset: ComfyUiAsset): boolean {
  return asset.filename.toLowerCase().startsWith(COMFYUI_INPAINT_RESULT_DEBUG_FILENAME_PREFIX);
}

function isComfyUiDiagnosticAsset(asset: ComfyUiAsset): boolean {
  return isComfyUiInpaintMaskAsset(asset) || isComfyUiInpaintResultDebugAsset(asset);
}

function getComfyUiDiagnosticLabel(asset: ComfyUiAsset): string {
  const filename = asset.filename.toLowerCase();
  if (isComfyUiInpaintResultDebugAsset(asset)) {
    return "Inpaint result debug";
  }
  if (filename.startsWith(`${COMFYUI_INPAINT_MASK_FILENAME_PREFIX}_detected`)) {
    return "Detected inpaint mask";
  }
  if (filename.startsWith(`${COMFYUI_INPAINT_MASK_FILENAME_PREFIX}_overlay`)) {
    return "Inpaint mask overlay";
  }
  if (isComfyUiInpaintMaskAsset(asset)) {
    return "Final inpaint mask";
  }
  return "ComfyUI diagnostic";
}

function isComfyUiDiagnosticSaveImageNode(node: unknown): boolean {
  if (!isRecord(node) || !isRecord(node.inputs) || typeof node.class_type !== "string") {
    return false;
  }
  if (!node.class_type.toLowerCase().includes("saveimage")) {
    return false;
  }

  const filenamePrefix = typeof node.inputs.filename_prefix === "string" ? node.inputs.filename_prefix.toLowerCase() : "";
  return (
    filenamePrefix.startsWith(COMFYUI_INPAINT_MASK_FILENAME_PREFIX) ||
    filenamePrefix.startsWith(COMFYUI_INPAINT_RESULT_DEBUG_FILENAME_PREFIX)
  );
}

function isComfyUiOutpaintDiagnosticSaveImageNode(node: unknown): boolean {
  if (!isRecord(node) || !isRecord(node.inputs)) {
    return false;
  }
  const filenamePrefix = typeof node.inputs.filename_prefix === "string" ? node.inputs.filename_prefix.toLowerCase() : "";
  return filenamePrefix.includes("_outpaint");
}

function pruneComfyUiOutpaintDiagnosticSaveNodes(workflow: ComfyUiWorkflow): number {
  let removed = 0;
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (isComfyUiDiagnosticSaveImageNode(node) && !isComfyUiOutpaintDiagnosticSaveImageNode(node)) {
      delete workflow[nodeId];
      removed += 1;
    }
  }
  return removed;
}

function describeComfyUiAssets(files: ComfyUiAsset[]): string {
  return files
    .slice(0, 10)
    .map((file) => [file.subfolder, file.filename].filter(Boolean).join("/"))
    .join(", ");
}

function parseComfyUiRecolorTargetColor(prompt: string): RgbColor | null {
  const normalized = prompt.toLowerCase();
  const colorPatterns: Array<[RegExp, RgbColor]> = [
    [
      /\b(?:dark|deep|near[-\s]?black|almost\s+black|blackish)\s+(?:purple|violet)\b|\b(?:purple|violet)\s+(?:near[-\s]?black|almost\s+black|blackish)\b/,
      { r: 42, g: 20, b: 68 },
    ],
    [
      /\b(?:dark|deep|near[-\s]?black|almost\s+black|blackish)\s+(?:blue|navy)\b|\b(?:blue|navy)\s+(?:near[-\s]?black|almost\s+black|blackish)\b/,
      { r: 18, g: 30, b: 78 },
    ],
    [
      /\b(?:dark|deep|near[-\s]?black|almost\s+black|blackish)\s+(?:red|burgundy|maroon)\b|\b(?:red|burgundy|maroon)\s+(?:near[-\s]?black|almost\s+black|blackish)\b/,
      { r: 74, g: 18, b: 28 },
    ],
    [/\bred[-\s]?orange\b|\borange[-\s]?red\b|\bcopper\b|\bginger\b|\bauburn\b/, { r: 229, g: 83, b: 24 }],
    [/\borange\b|\btabby\b/, { r: 230, g: 116, b: 28 }],
    [/\bred\b/, { r: 210, g: 42, b: 42 }],
    [/\byellow\b|\bgold(?:en)?\b/, { r: 232, g: 188, b: 48 }],
    [/\bgreen\b|\bemerald\b/, { r: 38, g: 168, b: 96 }],
    [/\bcyan\b|\bteal\b/, { r: 26, g: 174, b: 180 }],
    [/\bblue\b/, { r: 54, g: 116, b: 220 }],
    [/\bpurple\b|\bviolet\b/, { r: 132, g: 72, b: 190 }],
    [/\bpink\b|\bmagenta\b/, { r: 224, g: 92, b: 154 }],
    [/\bbrown\b/, { r: 128, g: 77, b: 42 }],
    [/\bblack\b/, { r: 28, g: 25, b: 24 }],
    [/\bwhite\b/, { r: 236, g: 232, b: 220 }],
    [/\bgrey\b|\bgray\b|\bsilver\b/, { r: 150, g: 150, b: 150 }],
  ];

  return colorPatterns.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function rgbToComfyUiColor(color: RgbColor): number {
  return (color.r << 16) + (color.g << 8) + color.b;
}

function shouldUseComfyUiMaskedTintReference(options: ComfyUiGenerationOptions): boolean {
  const enabledOverride =
    readOptionalBooleanEnv("COMFYUI_INPAINT_USE_MASKED_TINT_REFERENCE") ??
    readOptionalBooleanEnv("ANIMA3_INPAINT_USE_MASKED_TINT_REFERENCE") ??
    false;
  if (!enabledOverride) {
    return false;
  }

  const maskMode = normalizeComfyUiMaskMode(options.inpaintMaskMode);
  const inpaintPreset = inferComfyUiInpaintPreset(options);
  const inpaintMode = normalizeComfyUiInpaintMode(options);
  const hairMaskPrompt = isComfyUiHairMaskPrompt(options.maskPrompt);
  const hairRecolor = inpaintPreset !== "background" && hairMaskPrompt;

  return (
    options.mode === "image" &&
    options.inpaint === true &&
    maskMode === "target" &&
    inpaintMode !== "extend" &&
    hairRecolor &&
    parseComfyUiRecolorTargetColor(options.prompt) !== null
  );
}

function shouldUseComfyUiDifferentialDiffusion(options: ComfyUiGenerationOptions): boolean {
  const enabledOverride =
    readOptionalBooleanEnv("COMFYUI_INPAINT_USE_DIFFERENTIAL_DIFFUSION") ??
    readOptionalBooleanEnv("ANIMA3_INPAINT_USE_DIFFERENTIAL_DIFFUSION");
  if (enabledOverride !== null) {
    return enabledOverride;
  }

  return (
    options.mode === "image" &&
    options.inpaint === true &&
    normalizeComfyUiMaskMode(options.inpaintMaskMode) === "target" &&
    normalizeComfyUiInpaintMode(options) === "normal" &&
    inferComfyUiInpaintPreset(options) !== "background" &&
    (isComfyUiClothingMaskPrompt(options.maskPrompt) || isComfyUiHairMaskPrompt(options.maskPrompt))
  );
}

function shouldUseComfyUiClothingParser(options: ComfyUiGenerationOptions): boolean {
  if (options.disableClothingParser) {
    return false;
  }

  const explicitClothingCategories = (options.clothingSegmentCategories ?? []).some(
    (category) => normalizeComfyUiClothingSegmentCategory(category) !== null,
  );
  const enabledOverride =
    readOptionalBooleanEnv("COMFYUI_INPAINT_USE_CLOTHING_PARSER") ??
    readOptionalBooleanEnv("ANIMA3_INPAINT_USE_CLOTHING_PARSER");
  if (enabledOverride !== null) {
    return enabledOverride;
  }

  return (
    options.mode === "image" &&
    options.inpaint === true &&
    normalizeComfyUiMaskMode(options.inpaintMaskMode) === "target" &&
    normalizeComfyUiInpaintMode(options) === "normal" &&
    inferComfyUiInpaintPreset(options) !== "background" &&
    isComfyUiHairMaskPrompt(options.maskPrompt) &&
    !explicitClothingCategories
  );
}

function shouldUseComfyUiClothingParserHairTarget(_options: ComfyUiGenerationOptions): boolean {
  const enabledOverride =
    readOptionalBooleanEnv("COMFYUI_INPAINT_USE_CLOTHING_PARSER_HAIR_TARGET") ??
    readOptionalBooleanEnv("ANIMA3_INPAINT_USE_CLOTHING_PARSER_HAIR_TARGET");
  if (enabledOverride !== null) {
    return enabledOverride;
  }

  return false;
}

function shouldUseComfyUiClothingParserProtection(options: ComfyUiGenerationOptions): boolean {
  const enabledOverride =
    readOptionalBooleanEnv("COMFYUI_INPAINT_USE_CLOTHING_PARSER_PROTECTION") ??
    readOptionalBooleanEnv("ANIMA3_INPAINT_USE_CLOTHING_PARSER_PROTECTION");
  if (enabledOverride !== null) {
    return enabledOverride;
  }

  return (
    options.mode === "image" &&
    options.inpaint === true &&
    normalizeComfyUiMaskMode(options.inpaintMaskMode) === "target" &&
    normalizeComfyUiInpaintMode(options) === "normal" &&
    inferComfyUiInpaintPreset(options) !== "background" &&
    isComfyUiHairMaskPrompt(options.maskPrompt)
  );
}

function shouldUseComfyUiRmbgBackgroundMask(options: ComfyUiGenerationOptions): boolean {
  const enabledOverride =
    readOptionalBooleanEnv("COMFYUI_INPAINT_USE_RMBG_BACKGROUND_MASK") ??
    readOptionalBooleanEnv("ANIMA3_INPAINT_USE_RMBG_BACKGROUND_MASK");
  if (enabledOverride !== null) {
    return enabledOverride;
  }

  return (
    options.mode === "image" &&
    options.inpaint === true &&
    normalizeComfyUiMaskMode(options.inpaintMaskMode) === "background" &&
    normalizeComfyUiInpaintMode(options) === "normal"
  );
}

function stringifyWorkflowPlaceholder(value: WorkflowPlaceholderValue): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function replaceWorkflowStringPlaceholders(
  value: string,
  placeholders: Record<string, WorkflowPlaceholderValue>,
): WorkflowPlaceholderValue {
  const exactMatch = value.match(/^\{([A-Z0-9_]+)\}$/);
  if (exactMatch && Object.hasOwn(placeholders, exactMatch[1])) {
    return placeholders[exactMatch[1]];
  }

  let replaced = value;
  for (const [placeholderName, placeholderValue] of Object.entries(placeholders)) {
    const token = `{${placeholderName}}`;
    if (!replaced.includes(token)) {
      continue;
    }
    replaced = replaced.split(token).join(stringifyWorkflowPlaceholder(placeholderValue));
  }

  return replaced;
}

function replaceWorkflowPlaceholders(value: unknown, placeholders: Record<string, WorkflowPlaceholderValue>): unknown {
  if (typeof value === "string") {
    return replaceWorkflowStringPlaceholders(value, placeholders);
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceWorkflowPlaceholders(item, placeholders));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [key, replaceWorkflowPlaceholders(childValue, placeholders)]),
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepCloneWorkflow(workflow: Record<string, unknown>): ComfyUiWorkflow {
  return structuredClone(workflow) as ComfyUiWorkflow;
}

function workflowContainsPlaceholder(value: unknown, placeholder: string): boolean {
  if (typeof value === "string") {
    return value.includes(`{${placeholder}}`);
  }
  if (Array.isArray(value)) {
    return value.some((item) => workflowContainsPlaceholder(item, placeholder));
  }
  if (isRecord(value)) {
    return Object.values(value).some((childValue) => workflowContainsPlaceholder(childValue, placeholder));
  }
  return false;
}

function isComfyUiNodeLink(value: unknown): value is [string, number] {
  return Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "number";
}

function readComfyUiBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return null;
}

function rewriteComfyUiNodeReferences(workflow: ComfyUiWorkflow, fromNodeId: string, toLink: [string, number]): number {
  let rewritten = 0;

  for (const node of Object.values(workflow)) {
    if (!isRecord(node) || !isRecord(node.inputs)) {
      continue;
    }

    for (const [inputName, inputValue] of Object.entries(node.inputs)) {
      if (isComfyUiNodeLink(inputValue) && inputValue[0] === fromNodeId) {
        node.inputs[inputName] = [...toLink];
        rewritten += 1;
      }
    }
  }

  return rewritten;
}

function foldConstantComfyUiConditionals(workflow: ComfyUiWorkflow): number {
  let totalRewritten = 0;

  for (let pass = 0; pass < 10; pass += 1) {
    const constantBooleans = new Map<string, boolean>();
    for (const [nodeId, node] of Object.entries(workflow)) {
      if (!isRecord(node) || !isRecord(node.inputs) || typeof node.class_type !== "string") {
        continue;
      }

      if (node.class_type.toLowerCase().includes("impactconvertdatatype")) {
        const value = readComfyUiBooleanValue(node.inputs.value);
        if (value !== null) {
          constantBooleans.set(nodeId, value);
        }
      }
    }

    let passRewritten = 0;
    for (const [nodeId, node] of Object.entries(workflow)) {
      if (!isRecord(node) || !isRecord(node.inputs) || typeof node.class_type !== "string") {
        continue;
      }

      if (!node.class_type.toLowerCase().includes("impactconditionalbranch")) {
        continue;
      }

      const cond = node.inputs.cond;
      if (!isComfyUiNodeLink(cond)) {
        continue;
      }

      const condValue = constantBooleans.get(cond[0]);
      if (condValue === undefined) {
        continue;
      }

      const selectedInput = condValue ? node.inputs.tt_value : node.inputs.ff_value;
      if (!isComfyUiNodeLink(selectedInput)) {
        continue;
      }

      passRewritten += rewriteComfyUiNodeReferences(workflow, nodeId, selectedInput);
    }

    totalRewritten += passRewritten;
    if (passRewritten === 0) {
      break;
    }
  }

  return totalRewritten;
}

function hasActiveComfyUiOutpaintNode(workflow: ComfyUiWorkflow): boolean {
  return Object.values(workflow).some((node) => {
    if (!isRecord(node) || !isRecord(node.inputs) || typeof node.class_type !== "string") {
      return false;
    }
    return node.class_type.toLowerCase().includes("inpaintcrop") && node.inputs.extend_for_outpainting === true;
  });
}

function assertComfyUiFullCanvasOutpaintWorkflow(savedWorkflow: ComfyUiWorkflow): void {
  if (workflowContainsPlaceholder(savedWorkflow, "TOMORI_OUTPAINT_FULL_CANVAS")) {
    return;
  }

  throw new Error(
    [
      "The active ComfyUI workflow does not expose a full-canvas outpaint branch.",
      "Add a branch gated by {TOMORI_OUTPAINT_FULL_CANVAS}, or set COMFYUI_OUTPAINT_STRATEGY=edge_extend to keep using CropAndStitch outpainting.",
      "Full-canvas outpainting must avoid InpaintCropImproved/InpaintStitchImproved and feed the expanded canvas plus border mask directly into inpaint conditioning.",
    ].join(" "),
  );
}

function hasComfyUiVisualWorkflowShape(workflow: ComfyUiWorkflow): boolean {
  return Array.isArray(workflow.nodes) || Array.isArray(workflow.links) || Array.isArray(workflow.groups);
}

function buildReferenceImageDataUrl(options: ComfyUiGenerationOptions): string | null {
  if (options.referenceImageDataUrl) {
    return options.referenceImageDataUrl;
  }

  const firstReferenceImage = options.referenceImages?.[0];
  if (!firstReferenceImage) {
    return null;
  }

  return `data:${firstReferenceImage.mimeType};base64,${firstReferenceImage.data}`;
}

function readComfyUiWorkflowSupports(endpoint: CustomEndpointRow): ComfyUiWorkflowSupports {
  const rawSupports = endpoint.extra_config.workflow_supports;
  if (!isRecord(rawSupports)) {
    return DEFAULT_COMFYUI_WORKFLOW_SUPPORTS;
  }

  return {
    txt2img: typeof rawSupports.txt2img === "boolean" ? rawSupports.txt2img : DEFAULT_COMFYUI_WORKFLOW_SUPPORTS.txt2img,
    img2img: typeof rawSupports.img2img === "boolean" ? rawSupports.img2img : DEFAULT_COMFYUI_WORKFLOW_SUPPORTS.img2img,
    inpaint: typeof rawSupports.inpaint === "boolean" ? rawSupports.inpaint : DEFAULT_COMFYUI_WORKFLOW_SUPPORTS.inpaint,
  };
}

function assertComfyUiWorkflowSupportsRequest(
  options: ComfyUiGenerationOptions,
  supports: ComfyUiWorkflowSupports,
): void {
  const hasReference = !!buildReferenceImageDataUrl(options);
  if (options.inpaint === true && !hasReference) {
    throw new Error("Inpaint requires a reference image.");
  }
  if (options.inpaint === true && !options.maskPrompt?.trim()) {
    throw new Error("Inpaint requires a mask_prompt describing the region to edit.");
  }
  if (options.inpaint === true && !supports.inpaint) {
    throw new Error("This ComfyUI workflow is not configured to support inpaint requests.");
  }
  if (hasReference && options.inpaint !== true && !supports.img2img) {
    throw new Error("This ComfyUI workflow is not configured to support reference-image requests.");
  }
  if (!hasReference && !supports.txt2img) {
    throw new Error("This ComfyUI workflow is not configured to support text-to-image requests.");
  }
}

function applyComfyUiImageInputDefaults(
  workflow: ComfyUiWorkflow,
  options: ComfyUiGenerationOptions & { seed: number },
): number {
  const inpaintSettings = resolveComfyUiInpaintSettings(options);
  const inpaint = !!buildReferenceImageDataUrl(options) && options.inpaint === true;
  const maskMode = inpaint ? normalizeComfyUiMaskMode(options.inpaintMaskMode) : "target";
  const referenceDenoise = resolveComfyUiEffectiveDenoise(options, inpaint, maskMode);
  let defaultsApplied = 0;

  for (const node of Object.values(workflow)) {
    if (!isRecord(node) || !isRecord(node.inputs)) {
      continue;
    }

    const classType = typeof node.class_type === "string" ? node.class_type.toLowerCase() : "";
    const inputs = node.inputs;

    if (classType.includes("clipseg") && inputs.threshold == null) {
      inputs.threshold = inpaintSettings.maskThreshold;
      defaultsApplied += 1;
    }

    if (classType.includes("growmask")) {
      if (inputs.expand == null) {
        inputs.expand = inpaintSettings.maskGrow;
        defaultsApplied += 1;
      }
      if (inputs.blur_radius == null) {
        inputs.blur_radius = inpaintSettings.maskFeather;
        defaultsApplied += 1;
      }
    }

    const looksLikeSampler = classType.includes("ksampler") || ("sampler_name" in inputs && "latent_image" in inputs);
    const looksLikeSeedNode = classType.includes("seedgenerator");
    if ((looksLikeSampler || looksLikeSeedNode) && "seed" in inputs && !Array.isArray(inputs.seed)) {
      inputs.seed = options.seed;
      defaultsApplied += 1;
    }
    if (looksLikeSampler && "noise_seed" in inputs && !Array.isArray(inputs.noise_seed)) {
      inputs.noise_seed = options.seed;
      defaultsApplied += 1;
    }
    if (looksLikeSampler && inputs.denoise == null) {
      inputs.denoise = referenceDenoise;
      defaultsApplied += 1;
    }
    if (looksLikeSampler && inputs.cfg == null && options.inpaint === true) {
      inputs.cfg = inpaintSettings.cfg;
      defaultsApplied += 1;
    }
  }

  return defaultsApplied;
}

function buildComfyUiPlaceholderMap(
  endpoint: CustomEndpointRow,
  options: ComfyUiGenerationOptions,
  dimensions: { source: { width: number; height: number }; output: { width: number; height: number } },
  referencePayload: Array<Record<string, unknown>>,
): Record<string, WorkflowPlaceholderValue> {
  const referenceImageDataUrl = buildReferenceImageDataUrl(options);
  const hasReference = !!referenceImageDataUrl;
  const inpaint = hasReference && options.inpaint === true;
  const requestedMaskPrompt = options.maskPrompt?.trim() || options.prompt;
  const outpaint = inpaint && isComfyUiOutpaint(options);
  const maskPrompt =
    outpaint && /^main foreground object$/i.test(requestedMaskPrompt)
      ? inferComfyUiForegroundMaskPrompt(options.prompt)
      : requestedMaskPrompt;
  const seed = options.seed ?? generateComfyUiSeed();
  const firstReferenceImage = referencePayload[0];
  const maskMode = inpaint ? normalizeComfyUiMaskMode(options.inpaintMaskMode) : "target";
  const workflowMaskPrompt = resolveComfyUiWorkflowMaskPrompt(maskPrompt, maskMode, options.prompt);
  const invertInpaintMask = maskMode === "background";
  const promptOptions = workflowMaskPrompt === maskPrompt ? options : { ...options, maskPrompt: workflowMaskPrompt };
  const rawInpaintSettings = resolveComfyUiInpaintSettings(options);
  const inpaintSettings = resolveComfyUiEffectiveInpaintSettings(rawInpaintSettings, inpaint, maskMode);
  const protectionSettings = resolveComfyUiMaskProtectionSettings({ ...options, inpaint });
  const denoise = resolveComfyUiEffectiveDenoise(options, inpaint, maskMode);
  const inpaintMaskContent = resolveComfyUiInpaintMaskContent(options, inpaint, maskMode);
  const maskedTintReference = shouldUseComfyUiMaskedTintReference(options);
  const useDifferentialDiffusion = shouldUseComfyUiDifferentialDiffusion(options);
  const useRmbgBackgroundMask = shouldUseComfyUiRmbgBackgroundMask(options);
  const useClothingParser = shouldUseComfyUiClothingParser(options);
  const useClothingParserTarget = useClothingParser && isComfyUiClothingMaskPrompt(options.maskPrompt);
  const useClothingParserHairTarget = shouldUseComfyUiClothingParserHairTarget(options);
  const useClothingParserProtection =
    useClothingParser && isComfyUiHairMaskPrompt(options.maskPrompt) && shouldUseComfyUiClothingParserProtection(options);
  const useSubtractionProtection = protectionSettings.enabled;
  const clothingSegmentCategories = resolveComfyUiClothingSegmentCategories(options);
  const clothingSegmentSelection = createComfyUiClothingSegmentSelection(clothingSegmentCategories);
  const differentialDiffusionStrength = clampNumber(
    readOptionalNumberEnv("COMFYUI_INPAINT_DIFFERENTIAL_DIFFUSION_STRENGTH") ??
      readOptionalNumberEnv("ANIMA3_INPAINT_DIFFERENTIAL_DIFFUSION_STRENGTH") ??
      1,
    0,
    1,
  );
  const recolorTargetColor = parseComfyUiRecolorTargetColor(options.prompt);
  const maskedTintBlend = clampNumber(
    readOptionalNumberEnv("COMFYUI_INPAINT_MASKED_TINT_BLEND") ??
      readOptionalNumberEnv("ANIMA3_INPAINT_MASKED_TINT_BLEND") ??
      0.28,
    0,
    1,
  );
  const subtractClothingMask =
    useSubtractionProtection &&
    (readOptionalBooleanEnv("COMFYUI_INPAINT_SUBTRACT_CLOTHING_MASK") ??
      readOptionalBooleanEnv("COMFYUI_INPAINT_SUBTRACT_BODY_MASK") ??
      readOptionalBooleanEnv("ANIMA3_INPAINT_SUBTRACT_CLOTHING_MASK") ??
      readOptionalBooleanEnv("ANIMA3_INPAINT_SUBTRACT_BODY_MASK") ??
      true);
  const inpaintMode = inpaint ? normalizeComfyUiInpaintMode(options) : "normal";
  const inpaintPreset = inpaint ? inferComfyUiInpaintPreset(options) : "";
  const maskPromptIsHair = isComfyUiHairMaskPrompt(maskPrompt);
  const requestedExtendDirection = normalizeComfyUiExtendDirection(options.inpaintExtendDirection);
  const extendDirection =
    inpaintMode === "extend" && maskPromptIsHair && requestedExtendDirection === "all"
      ? "down"
      : requestedExtendDirection;
  const outpaintPixels = resolveComfyUiOutpaintPixels(options);
  const effectiveExtendPixels = outpaint ? outpaintPixels : inpaintSettings.extendPixels;
  const extendOffset = resolveComfyUiExtendOffset(extendDirection, effectiveExtendPixels);
  const outpaintLayout = outpaint
    ? buildComfyUiOutpaintLayout(options, dimensions.source, dimensions.output, extendDirection)
    : null;
  const outpaintStrategy = outpaintLayout?.strategy ?? "edge_extend";
  const workflowOutpaintFactors = getComfyUiLayoutOutpaintFactors(
    outpaintLayout,
    dimensions.output,
    extendDirection,
    outpaint,
    outpaintPixels,
  );
  const workflowSourceWidth = outpaintLayout?.placedSourceWidth ?? dimensions.source.width;
  const workflowSourceHeight = outpaintLayout?.placedSourceHeight ?? dimensions.source.height;
  const outpaintSourceX = outpaintLayout?.placedSourceX ?? 0;
  const outpaintSourceY = outpaintLayout?.placedSourceY ?? 0;
  const outpaintPadLeft = outpaintLayout?.placedSourceX ?? 0;
  const outpaintPadTop = outpaintLayout?.placedSourceY ?? 0;
  const outpaintPadRight = outpaintLayout
    ? Math.max(0, dimensions.output.width - outpaintLayout.placedSourceX - outpaintLayout.placedSourceWidth)
    : 0;
  const outpaintPadBottom = outpaintLayout
    ? Math.max(0, dimensions.output.height - outpaintLayout.placedSourceY - outpaintLayout.placedSourceHeight)
    : 0;
  const largestOutpaintPad = Math.max(outpaintPadLeft, outpaintPadTop, outpaintPadRight, outpaintPadBottom);
  const outpaintPadFeather = largestOutpaintPad > 0 ? Math.min(resolveComfyUiOutpaintPadFeather(), largestOutpaintPad) : 0;
  const placeholderMap: Record<string, WorkflowPlaceholderValue> = {
    TOMORI_PROMPT: options.prompt,
    TOMORI_PROMPT_WITH_DEFAULTS: buildComfyUiPromptWithDefaults(
      promptOptions,
      inpaint,
      maskMode,
      invertInpaintMask,
      hasReference,
    ),
    TOMORI_NEGATIVE_PROMPT: buildComfyUiNegativePrompt(options, inpaint, maskMode),
    TOMORI_MODEL: endpoint.model_name ?? endpoint.display_name,
    TOMORI_MODEL_NAME: endpoint.model_name ?? endpoint.display_name,
    TOMORI_MODE: options.mode,
    TOMORI_IMAGE_MODE: inpaint ? "inpaint" : hasReference ? "img2img" : "txt2img",
    TOMORI_ASPECT_RATIO: options.aspectRatio ?? (options.mode === "video" ? "16:9" : "1:1"),
    TOMORI_WIDTH: dimensions.output.width,
    TOMORI_HEIGHT: dimensions.output.height,
    TOMORI_SOURCE_WIDTH: workflowSourceWidth,
    TOMORI_SOURCE_HEIGHT: workflowSourceHeight,
    TOMORI_ORIGINAL_SOURCE_WIDTH: dimensions.source.width,
    TOMORI_ORIGINAL_SOURCE_HEIGHT: dimensions.source.height,
    TOMORI_OUTPUT_WIDTH: dimensions.output.width,
    TOMORI_OUTPUT_HEIGHT: dimensions.output.height,
    TOMORI_SIZE: `${dimensions.output.width}x${dimensions.output.height}`,
    TOMORI_SOURCE_SIZE: `${dimensions.source.width}x${dimensions.source.height}`,
    TOMORI_OUTPUT_SIZE: `${dimensions.output.width}x${dimensions.output.height}`,
    TOMORI_SEED: seed,
    TOMORI_HAS_REFERENCE_IMAGE: hasReference,
    TOMORI_REFERENCE_IMAGE_DATA_URL: referenceImageDataUrl ?? "",
    TOMORI_REFERENCE_IMAGE_BASE64:
      firstReferenceImage && typeof firstReferenceImage.data === "string" ? firstReferenceImage.data : "",
    TOMORI_REFERENCE_IMAGE_MIME_TYPE:
      firstReferenceImage && typeof firstReferenceImage.mimeType === "string" ? firstReferenceImage.mimeType : "",
    TOMORI_INPAINT: inpaint,
    TOMORI_INPAINT_MASK_MODE: maskMode,
    TOMORI_INPAINT_PRESET: inpaintPreset,
    TOMORI_INPAINT_INVERT_MASK: invertInpaintMask,
    TOMORI_INPAINT_MODE: inpaintMode,
    TOMORI_OUTPAINT: outpaint,
    TOMORI_OUTPAINT_STRATEGY: outpaintStrategy,
    TOMORI_OUTPAINT_FULL_CANVAS: outpaintStrategy === "full_canvas",
    TOMORI_OUTPAINT_EDGE_EXTEND: outpaintStrategy === "edge_extend",
    TOMORI_OUTPAINT_USE_CROP_STITCH: outpaintStrategy !== "full_canvas",
    TOMORI_OUTPAINT_ZOOM_OUT: outpaintStrategy === "zoom_out",
    TOMORI_OUTPAINT_AMOUNT: resolveComfyUiOutpaintAmount(options),
    TOMORI_OUTPAINT_SOURCE_SCALE: outpaintLayout?.sourceScale ?? 1,
    TOMORI_OUTPAINT_OVERLAP: outpaintLayout?.overlap ?? 0,
    TOMORI_OUTPAINT_DIRECTION: extendDirection,
    TOMORI_OUTPAINT_PIXELS: outpaintPixels,
    TOMORI_OUTPAINT_SOURCE_X: outpaintSourceX,
    TOMORI_OUTPAINT_SOURCE_Y: outpaintSourceY,
    TOMORI_OUTPAINT_PLACED_SOURCE_X: outpaintLayout?.placedSourceX ?? 0,
    TOMORI_OUTPAINT_PLACED_SOURCE_Y: outpaintLayout?.placedSourceY ?? 0,
    TOMORI_OUTPAINT_PLACED_SOURCE_WIDTH: outpaintLayout?.placedSourceWidth ?? dimensions.source.width,
    TOMORI_OUTPAINT_PLACED_SOURCE_HEIGHT: outpaintLayout?.placedSourceHeight ?? dimensions.source.height,
    TOMORI_OUTPAINT_PAD_LEFT: outpaintPadLeft,
    TOMORI_OUTPAINT_PAD_TOP: outpaintPadTop,
    TOMORI_OUTPAINT_PAD_RIGHT: outpaintPadRight,
    TOMORI_OUTPAINT_PAD_BOTTOM: outpaintPadBottom,
    TOMORI_OUTPAINT_PAD_FEATHER: outpaintPadFeather,
    TOMORI_OUTPAINT_BLEND_FEATHER: resolveComfyUiOutpaintBlendFeather(),
    TOMORI_OUTPAINT_CENTER_PRESERVE_FEATHER: resolveComfyUiOutpaintCenterPreserveFeather(),
    TOMORI_OUTPAINT_GUIDE_BLUR_RADIUS: resolveComfyUiOutpaintGuideBlurRadius(),
    TOMORI_OUTPAINT_GUIDE_BLUR_SIGMA: resolveComfyUiOutpaintGuideBlurSigma(),
    TOMORI_OUTPAINT_DENOISE: resolveComfyUiOutpaintDenoise(),
    TOMORI_OUTPAINT_MASK_SOURCE_X: outpaintLayout?.maskSourceX ?? 0,
    TOMORI_OUTPAINT_MASK_SOURCE_Y: outpaintLayout?.maskSourceY ?? 0,
    TOMORI_OUTPAINT_PROTECTED_SOURCE_X:
      outpaintLayout ? Math.max(0, outpaintLayout.maskSourceX - outpaintLayout.placedSourceX) : 0,
    TOMORI_OUTPAINT_PROTECTED_SOURCE_Y:
      outpaintLayout ? Math.max(0, outpaintLayout.maskSourceY - outpaintLayout.placedSourceY) : 0,
    TOMORI_OUTPAINT_MASK_SOURCE_WIDTH: outpaintLayout?.maskSourceWidth ?? dimensions.source.width,
    TOMORI_OUTPAINT_MASK_SOURCE_HEIGHT: outpaintLayout?.maskSourceHeight ?? dimensions.source.height,
    TOMORI_OUTPAINT_PRESERVE_SUBJECT_ONLY: false,
    TOMORI_OUTPAINT_SUBJECT_MASK_GROW: resolveComfyUiOutpaintSubjectMaskGrow(),
    TOMORI_OUTPAINT_SUBJECT_MASK_FEATHER: resolveComfyUiOutpaintSubjectMaskFeather(),
    TOMORI_OUTPAINT_UNDERPAINT_COLOR: resolveComfyUiOutpaintUnderpaintColor(),
    TOMORI_OUTPAINT_EXTEND_UP_FACTOR: workflowOutpaintFactors.up,
    TOMORI_OUTPAINT_EXTEND_DOWN_FACTOR: workflowOutpaintFactors.down,
    TOMORI_OUTPAINT_EXTEND_LEFT_FACTOR: workflowOutpaintFactors.left,
    TOMORI_OUTPAINT_EXTEND_RIGHT_FACTOR: workflowOutpaintFactors.right,
    TOMORI_MASK_PROMPT: workflowMaskPrompt,
    TOMORI_INPAINT_MASK_CONTENT: inpaintMaskContent,
    TOMORI_INPAINT_USE_LATENT_NOISE_MASK_CONTENT: inpaintMaskContent === "latent_noise",
    TOMORI_INPAINT_USE_DIFFERENTIAL_DIFFUSION: useDifferentialDiffusion,
    TOMORI_INPAINT_DIFFERENTIAL_DIFFUSION_STRENGTH: differentialDiffusionStrength,
    TOMORI_INPAINT_USE_RMBG_BACKGROUND_MASK: useRmbgBackgroundMask,
    TOMORI_RMBG_MODEL:
      readOptionalStringEnv("COMFYUI_RMBG_MODEL") ??
      readOptionalStringEnv("ANIMA3_RMBG_MODEL") ??
      "RMBG-2.0",
    TOMORI_RMBG_SENSITIVITY: clampNumber(
      readOptionalNumberEnv("COMFYUI_RMBG_SENSITIVITY") ?? readOptionalNumberEnv("ANIMA3_RMBG_SENSITIVITY") ?? 1,
      0,
      1,
    ),
    TOMORI_RMBG_PROCESS_RES: clampNumber(
      readOptionalNumberEnv("COMFYUI_RMBG_PROCESS_RES") ?? readOptionalNumberEnv("ANIMA3_RMBG_PROCESS_RES") ?? 1024,
      256,
      2048,
    ),
    TOMORI_RMBG_MASK_BLUR: clampNumber(
      readOptionalNumberEnv("COMFYUI_RMBG_MASK_BLUR") ?? readOptionalNumberEnv("ANIMA3_RMBG_MASK_BLUR") ?? 0,
      0,
      64,
    ),
    TOMORI_RMBG_MASK_OFFSET: clampNumber(
      readOptionalNumberEnv("COMFYUI_RMBG_MASK_OFFSET") ?? readOptionalNumberEnv("ANIMA3_RMBG_MASK_OFFSET") ?? 0,
      -64,
      64,
    ),
    TOMORI_RMBG_REFINE_FOREGROUND:
      readOptionalBooleanEnv("COMFYUI_RMBG_REFINE_FOREGROUND") ??
      readOptionalBooleanEnv("ANIMA3_RMBG_REFINE_FOREGROUND") ??
      false,
    TOMORI_INPAINT_USE_CLOTHING_PARSER: useClothingParser,
    TOMORI_INPAINT_USE_CLOTHING_PARSER_TARGET: useClothingParserTarget,
    TOMORI_INPAINT_USE_CLOTHING_PARSER_HAIR_TARGET: useClothingParserHairTarget,
    TOMORI_INPAINT_USE_CLOTHING_PARSER_PROTECTION: useClothingParserProtection,
    TOMORI_INPAINT_CLOTHING_SEGMENT_CATEGORIES: clothingSegmentCategories.join(","),
    TOMORI_INPAINT_CLOTHING_SEGMENT_HAT: clothingSegmentSelection.Hat,
    TOMORI_INPAINT_CLOTHING_SEGMENT_HAIR: clothingSegmentSelection.Hair,
    TOMORI_INPAINT_CLOTHING_SEGMENT_FACE: clothingSegmentSelection.Face,
    TOMORI_INPAINT_CLOTHING_SEGMENT_SUNGLASSES: clothingSegmentSelection.Sunglasses,
    TOMORI_INPAINT_CLOTHING_SEGMENT_UPPER_CLOTHES: clothingSegmentSelection["Upper-clothes"],
    TOMORI_INPAINT_CLOTHING_SEGMENT_SKIRT: clothingSegmentSelection.Skirt,
    TOMORI_INPAINT_CLOTHING_SEGMENT_DRESS: clothingSegmentSelection.Dress,
    TOMORI_INPAINT_CLOTHING_SEGMENT_BELT: clothingSegmentSelection.Belt,
    TOMORI_INPAINT_CLOTHING_SEGMENT_PANTS: clothingSegmentSelection.Pants,
    TOMORI_INPAINT_CLOTHING_SEGMENT_LEFT_ARM: clothingSegmentSelection["Left-arm"],
    TOMORI_INPAINT_CLOTHING_SEGMENT_RIGHT_ARM: clothingSegmentSelection["Right-arm"],
    TOMORI_INPAINT_CLOTHING_SEGMENT_LEFT_LEG: clothingSegmentSelection["Left-leg"],
    TOMORI_INPAINT_CLOTHING_SEGMENT_RIGHT_LEG: clothingSegmentSelection["Right-leg"],
    TOMORI_INPAINT_CLOTHING_SEGMENT_BAG: clothingSegmentSelection.Bag,
    TOMORI_INPAINT_CLOTHING_SEGMENT_SCARF: clothingSegmentSelection.Scarf,
    TOMORI_INPAINT_CLOTHING_SEGMENT_LEFT_SHOE: clothingSegmentSelection["Left-shoe"],
    TOMORI_INPAINT_CLOTHING_SEGMENT_RIGHT_SHOE: clothingSegmentSelection["Right-shoe"],
    TOMORI_INPAINT_CLOTHING_SEGMENT_BACKGROUND: clothingSegmentSelection.Background,
    TOMORI_INPAINT_USE_MASKED_TINT_REFERENCE: maskedTintReference,
    TOMORI_RECOLOR_TARGET_COLOR: recolorTargetColor ? rgbToComfyUiColor(recolorTargetColor) : 0,
    TOMORI_RECOLOR_TARGET_R: recolorTargetColor?.r ?? 0,
    TOMORI_RECOLOR_TARGET_G: recolorTargetColor?.g ?? 0,
    TOMORI_RECOLOR_TARGET_B: recolorTargetColor?.b ?? 0,
    TOMORI_INPAINT_MASKED_TINT_BLEND: maskedTintBlend,
    TOMORI_INPAINT_SUBTRACT_FACE_MASK: useSubtractionProtection,
    TOMORI_INPAINT_PROTECT_MASK_PROMPT: protectionSettings.maskPrompt,
    TOMORI_INPAINT_FACE_MASK_PROMPT: protectionSettings.maskPrompt,
    TOMORI_INPAINT_FACE_MASK_THRESHOLD: protectionSettings.maskThreshold,
    TOMORI_INPAINT_FACE_MASK_GROW: protectionSettings.maskGrow,
    TOMORI_INPAINT_FACE_MASK_FEATHER: protectionSettings.maskFeather,
    TOMORI_INPAINT_SUBTRACT_CLOTHING_MASK: subtractClothingMask,
    TOMORI_INPAINT_CLOTHING_MASK_PROMPT: protectionSettings.clothingMaskPrompt,
    TOMORI_INPAINT_CLOTHING_MASK_THRESHOLD: protectionSettings.clothingMaskThreshold,
    TOMORI_INPAINT_CLOTHING_MASK_GROW: protectionSettings.clothingMaskGrow,
    TOMORI_INPAINT_CLOTHING_MASK_FEATHER: protectionSettings.clothingMaskFeather,
    TOMORI_INPAINT_SUBTRACT_ARMS_MASK: useSubtractionProtection,
    TOMORI_INPAINT_ARMS_MASK_PROMPT: protectionSettings.armsMaskPrompt,
    TOMORI_INPAINT_ARMS_MASK_THRESHOLD: protectionSettings.armsMaskThreshold,
    TOMORI_INPAINT_ARMS_MASK_GROW: protectionSettings.armsMaskGrow,
    TOMORI_INPAINT_ARMS_MASK_FEATHER: protectionSettings.armsMaskFeather,
    TOMORI_INPAINT_SUBTRACT_NECK_MASK: useSubtractionProtection,
    TOMORI_INPAINT_NECK_MASK_PROMPT: protectionSettings.neckMaskPrompt,
    TOMORI_INPAINT_NECK_MASK_THRESHOLD: protectionSettings.neckMaskThreshold,
    TOMORI_INPAINT_NECK_MASK_GROW: protectionSettings.neckMaskGrow,
    TOMORI_INPAINT_NECK_MASK_FEATHER: protectionSettings.neckMaskFeather,
    TOMORI_INPAINT_SUBTRACT_SKIN_MASK: useSubtractionProtection,
    TOMORI_INPAINT_SKIN_MASK_PROMPT: protectionSettings.skinMaskPrompt,
    TOMORI_INPAINT_SKIN_MASK_THRESHOLD: protectionSettings.skinMaskThreshold,
    TOMORI_INPAINT_SKIN_MASK_GROW: protectionSettings.skinMaskGrow,
    TOMORI_INPAINT_SKIN_MASK_FEATHER: protectionSettings.skinMaskFeather,
    TOMORI_INPAINT_SUBTRACT_LEGS_MASK: false,
    TOMORI_INPAINT_LEGS_MASK_PROMPT: protectionSettings.legsMaskPrompt,
    TOMORI_INPAINT_LEGS_MASK_THRESHOLD: protectionSettings.legsMaskThreshold,
    TOMORI_INPAINT_LEGS_MASK_GROW: protectionSettings.legsMaskGrow,
    TOMORI_INPAINT_LEGS_MASK_FEATHER: protectionSettings.legsMaskFeather,
    TOMORI_INPAINT_SUBTRACT_FEET_MASK: false,
    TOMORI_INPAINT_FEET_MASK_PROMPT: protectionSettings.feetMaskPrompt,
    TOMORI_INPAINT_FEET_MASK_THRESHOLD: protectionSettings.feetMaskThreshold,
    TOMORI_INPAINT_FEET_MASK_GROW: protectionSettings.feetMaskGrow,
    TOMORI_INPAINT_FEET_MASK_FEATHER: protectionSettings.feetMaskFeather,
    TOMORI_INPAINT_SUBTRACT_BODY_MASK: subtractClothingMask,
    TOMORI_INPAINT_BODY_MASK_PROMPT: protectionSettings.clothingMaskPrompt,
    TOMORI_INPAINT_BODY_MASK_THRESHOLD: protectionSettings.clothingMaskThreshold,
    TOMORI_INPAINT_BODY_MASK_GROW: protectionSettings.clothingMaskGrow,
    TOMORI_INPAINT_BODY_MASK_FEATHER: protectionSettings.clothingMaskFeather,
    TOMORI_GROUNDINGDINO_MODEL:
      readOptionalStringEnv("COMFYUI_GROUNDINGDINO_MODEL") ??
      readOptionalStringEnv("ANIMA3_GROUNDINGDINO_MODEL") ??
      "GroundingDINO_SwinT_OGC (694MB)",
    TOMORI_SAM_MODEL:
      readOptionalStringEnv("COMFYUI_SAM_MODEL") ??
      readOptionalStringEnv("ANIMA3_SAM_MODEL") ??
      "sam_hq_vit_h (2.57GB)",
    TOMORI_INPAINT_MASK_THRESHOLD: inpaintSettings.maskThreshold,
    TOMORI_INPAINT_MASK_GROW: inpaintSettings.maskGrow,
    TOMORI_INPAINT_MASK_FEATHER: inpaintSettings.maskFeather,
    TOMORI_INPAINT_EXTEND_DIRECTION: extendDirection,
    TOMORI_INPAINT_EXTEND_PIXELS: effectiveExtendPixels,
    TOMORI_INPAINT_EXTEND_X: extendOffset.x,
    TOMORI_INPAINT_EXTEND_Y: extendOffset.y,
    TOMORI_INPAINT_EXTEND_GROW: inpaintSettings.extendGrow,
    TOMORI_INPAINT_EXTEND_FEATHER: inpaintSettings.extendFeather,
    TOMORI_INPAINT_EXTEND_PADDING: inpaintSettings.extendPadding,
    TOMORI_CFG: inpaint ? inpaintSettings.cfg : 0,
    TOMORI_INPAINT_CFG: inpaintSettings.cfg,
    TOMORI_DENOISE: denoise,
    TOMORI_IMG2IMG_DENOISE: denoise,
    TOMORI_INPAINT_DENOISE: denoise,
    TOMORI_INPAINT_MASK_FILENAME_PREFIX: COMFYUI_INPAINT_MASK_FILENAME_PREFIX,
    TOMORI_INPAINT_RESULT_DEBUG_FILENAME_PREFIX: COMFYUI_INPAINT_RESULT_DEBUG_FILENAME_PREFIX,
    TOMORI_REFERENCE_IMAGE_COUNT: referencePayload.length,
    TOMORI_REFERENCE_IMAGES: referencePayload,
    TOMORI_REFERENCE_IMAGES_JSON: JSON.stringify(referencePayload),
    TOMORI_VIDEO_DURATION: options.durationSeconds ?? 0,
    TOMORI_DURATION_SECONDS: options.durationSeconds ?? 0,
    TOMORI_VIDEO_RESOLUTION: options.resolution ?? "",
    TOMORI_RESOLUTION: options.resolution ?? "",
    TOMORI_GENERATE_AUDIO: options.generateAudio ?? false,
  };

  placeholderMap.TOMORI_REFERENCE_IMAGE_1_DATA_URL = placeholderMap.TOMORI_REFERENCE_IMAGE_DATA_URL;
  placeholderMap.TOMORI_REFERENCE_IMAGE_1_BASE64 = placeholderMap.TOMORI_REFERENCE_IMAGE_BASE64;
  placeholderMap.TOMORI_REFERENCE_IMAGE_1_MIME_TYPE = placeholderMap.TOMORI_REFERENCE_IMAGE_MIME_TYPE;

  for (const referenceImage of referencePayload) {
    const index = referenceImage.index as number;
    placeholderMap[`TOMORI_REFERENCE_IMAGE_${index}`] = referenceImage;
    placeholderMap[`TOMORI_REFERENCE_IMAGE_${index}_DATA_URL`] = referenceImage.dataUrl as string;
    placeholderMap[`TOMORI_REFERENCE_IMAGE_${index}_BASE64`] = referenceImage.data as string;
    placeholderMap[`TOMORI_REFERENCE_IMAGE_${index}_MIME_TYPE`] = referenceImage.mimeType as string;
    if (typeof referenceImage.url === "string") {
      placeholderMap[`TOMORI_REFERENCE_IMAGE_${index}_URL`] = referenceImage.url;
    }
  }

  return placeholderMap;
}

async function generateWithComfyUi(
  endpoint: CustomEndpointRow,
  apiKey: string,
  options: ComfyUiGenerationOptions,
): Promise<ComfyUiGenerationResponse> {
  const workflowPath = resolveComfyUiRuntimeWorkflowPath(endpoint);
  const savedWorkflow = workflowPath ? loadComfyUiWorkflowFromPath(workflowPath) : endpoint.extra_config.workflow;
  if (!savedWorkflow || typeof savedWorkflow !== "object") {
    throw new Error("ComfyUI workflow JSON is missing.");
  }

  const seed = options.seed ?? generateComfyUiSeed();
  const sanitizedPrompt = stripComfyUiNegativeInpaintClauses(
    stripComfyUiHairRecolorPreservationClauses(options.prompt, options.maskPrompt),
  );
  const strengthenedPrompt = strengthenComfyUiHairRecolorPrompt(sanitizedPrompt || options.prompt, options.maskPrompt);
  const generationOptions = { ...options, prompt: strengthenedPrompt, seed };
  const sourceDimensions = buildComfyUiDimensions(generationOptions);
  const outpaint =
    generationOptions.mode === "image" &&
    generationOptions.inpaint === true &&
    !!buildReferenceImageDataUrl(generationOptions) &&
    isComfyUiOutpaint(generationOptions);
  const outpaintStrategy = outpaint ? resolveComfyUiOutpaintStrategy(generationOptions) : "edge_extend";
  const outpaintDirection = normalizeComfyUiExtendDirection(generationOptions.inpaintExtendDirection);
  const outpaintPixels = resolveComfyUiOutpaintPixels(generationOptions);
  const dimensions = {
    source: sourceDimensions,
    output: outpaint
      ? buildComfyUiOutpaintDimensions(generationOptions, sourceDimensions, outpaintDirection, outpaintPixels)
      : sourceDimensions,
  };
  const referencePayload = buildComfyUiReferencePayload(generationOptions.referenceImages ?? []);
  const placeholders = buildComfyUiPlaceholderMap(endpoint, generationOptions, dimensions, referencePayload);
  const workflowSupports = readComfyUiWorkflowSupports(endpoint);
  const workflow = deepCloneWorkflow(savedWorkflow as Record<string, unknown>);
  if (hasComfyUiVisualWorkflowShape(workflow)) {
    throw new Error("ComfyUI workflow must be exported in API prompt format, not visual workflow format.");
  }
  if (generationOptions.mode === "image") {
    assertComfyUiWorkflowSupportsRequest(generationOptions, workflowSupports);
  }
  if (outpaint && outpaintStrategy === "full_canvas") {
    assertComfyUiFullCanvasOutpaintWorkflow(workflow);
  }

  const preparedWorkflow = replaceWorkflowPlaceholders(workflow, placeholders) as ComfyUiWorkflow;
  const constantConditionalRewrites = foldConstantComfyUiConditionals(preparedWorkflow);
  const prunedOutpaintDiagnosticSaves = outpaint ? pruneComfyUiOutpaintDiagnosticSaveNodes(preparedWorkflow) : 0;
  if (outpaint && outpaintStrategy !== "full_canvas" && !hasActiveComfyUiOutpaintNode(preparedWorkflow)) {
    throw new Error(
      [
        "This ComfyUI workflow does not have active outpainting support.",
        "Update the stored endpoint workflow or configure workflow_path/COMFYUI_WORKFLOW_JSON_PATH to the latest tomoribot-anima3-comfyui.json.",
        "The active workflow must expose InpaintCropImproved extend_for_outpainting with the TOMORI_OUTPAINT placeholders, or use TOMORI_OUTPAINT_FULL_CANVAS for full-canvas outpainting.",
      ].join(" "),
    );
  }
  const defaultsApplied =
    generationOptions.mode === "image" ? applyComfyUiImageInputDefaults(preparedWorkflow, generationOptions) : 0;
  if (generationOptions.mode === "image") {
    const referenceImageDataUrl = buildReferenceImageDataUrl(generationOptions);
    const hasReference = !!referenceImageDataUrl;
    const inpaint = hasReference && generationOptions.inpaint === true;
    const inpaintSettings = resolveComfyUiInpaintSettings(generationOptions);
    const maskMode = inpaint ? normalizeComfyUiMaskMode(generationOptions.inpaintMaskMode) : "target";
    const denoise = resolveComfyUiEffectiveDenoise(generationOptions, inpaint, maskMode);
    log.info(
      `Prepared ComfyUI image generation payload ${JSON.stringify({
        workflowPath: workflowPath ?? null,
        hasReference,
        inpaint,
        maskPrompt: generationOptions.maskPrompt?.trim() ?? null,
        seed,
        denoise,
        maskMode,
        inpaintMode: normalizeComfyUiInpaintMode(generationOptions),
        outpaint,
        outpaintStrategy: outpaint ? outpaintStrategy : null,
        requestedOutpaintStrategy: generationOptions.outpaintStrategy ?? null,
        outpaintDirection: outpaint ? placeholders.TOMORI_OUTPAINT_DIRECTION : null,
        maskThreshold: inpaintSettings.maskThreshold,
        maskGrow: inpaintSettings.maskGrow,
        maskFeather: inpaintSettings.maskFeather,
        cfg: inpaintSettings.cfg,
        referenceDenoise: denoise,
        defaultsApplied,
        constantConditionalRewrites,
        prunedOutpaintDiagnosticSaves,
      })}`,
    );
  }

  const postHeaders = buildCustomHeaders(apiKey);
  const getHeaders = { ...postHeaders };
  delete getHeaders["Content-Type"];
  const clientId = `tomoribot-${Date.now()}`;

  const promptResponse = await fetchUserRemoteUrl(`${endpoint.endpoint_url.replace(/\/+$/, "")}/prompt`, {
    method: "POST",
    headers: postHeaders,
    body: JSON.stringify({
      prompt: preparedWorkflow,
      client_id: clientId,
    }),
  });

  if (!promptResponse.ok) {
    const errorBody = await promptResponse.text().catch(() => "");
    const errorDetail = errorBody.trim() ? `: ${errorBody.trim().slice(0, 2000)}` : "";
    throw new Error(`ComfyUI prompt failed: ${promptResponse.status} ${promptResponse.statusText}${errorDetail}`);
  }

  const promptPayload = (await promptResponse.json()) as { prompt_id?: string };
  if (!promptPayload.prompt_id) {
    throw new Error("ComfyUI did not return a prompt_id.");
  }

  const timeoutAt = Date.now() + getComfyUiTimeoutMs();
  while (Date.now() < timeoutAt) {
    const historyResponse = await fetchUserRemoteUrl(
      `${endpoint.endpoint_url.replace(/\/+$/, "")}/history/${encodeURIComponent(promptPayload.prompt_id)}`,
      { headers: getHeaders },
    );

    if (historyResponse.ok) {
      const historyPayload = (await historyResponse.json()) as Record<
        string,
        {
          outputs?: Record<
            string,
            {
              images?: Array<{ filename: string; subfolder?: string; type?: string }>;
              gifs?: Array<{ filename: string; subfolder?: string; type?: string }>;
              videos?: Array<{ filename: string; subfolder?: string; type?: string }>;
            }
          >;
        }
      >;

      const historyItem = historyPayload[promptPayload.prompt_id];
      const outputs = historyItem?.outputs ? Object.values(historyItem.outputs) : [];
      const files = outputs.flatMap((output) => [
        ...(output.images ?? []),
        ...(output.gifs ?? []),
        ...(output.videos ?? []),
      ]);
      const finalFiles = generationOptions.mode === "image" ? files.filter((file) => !isComfyUiDiagnosticAsset(file)) : files;
      if (finalFiles.length > 0) {
        return { files, seed };
      }
    }

    await Bun.sleep(1500);
  }

  throw new Error("ComfyUI generation timed out.");
}

async function downloadComfyUiAsset(endpoint: CustomEndpointRow, apiKey: string, asset: ComfyUiAsset): Promise<Buffer> {
  const url = new URL(`${endpoint.endpoint_url.replace(/\/+$/, "")}/view`);
  url.searchParams.set("filename", asset.filename);
  if (asset.subfolder) {
    url.searchParams.set("subfolder", asset.subfolder);
  }
  if (asset.type) {
    url.searchParams.set("type", asset.type);
  }

  const headers = { ...buildCustomHeaders(apiKey) };
  delete headers["Content-Type"];

  const response = await fetchUserRemoteUrl(url.toString(), { headers });
  if (!response.ok) {
    throw new Error(`ComfyUI asset download failed: ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function generateCustomImageViaEndpoint(params: {
  endpoint: CustomEndpointRow;
  apiKey: string;
  prompt: string;
  aspectRatio: string;
  referenceImages?: ProviderNativeImageGenerationRequest["referenceImages"];
  referenceImageDataUrl?: string | null;
  inpaint?: boolean;
  maskPrompt?: string | null;
  seed?: number | null;
  inpaintMaskMode?: string | null;
  inpaintMode?: string | null;
  inpaintPreset?: string | null;
  outpaint?: boolean | null;
  outpaintStrategy?: string | null;
  outpaintAmount?: string | null;
  outpaintOverlap?: number | null;
  outpaintZoomScale?: number | null;
  inpaintExtendDirection?: string | null;
  inpaintExtendPixels?: number | null;
  inpaintExtendGrow?: number | null;
  inpaintExtendFeather?: number | null;
  inpaintExtendPadding?: number | null;
  clothingSegmentCategories?: string[] | null;
}): Promise<ProviderNativeImageGenerationResult> {
  const {
    endpoint,
    apiKey,
    prompt,
    aspectRatio,
    referenceImages,
    referenceImageDataUrl,
    inpaint,
    maskPrompt,
    seed,
    inpaintMaskMode,
    inpaintMode,
    inpaintPreset,
    outpaint,
    outpaintStrategy,
    outpaintAmount,
    outpaintOverlap,
    outpaintZoomScale,
    inpaintExtendDirection,
    inpaintExtendPixels,
    inpaintExtendGrow,
    inpaintExtendFeather,
    inpaintExtendPadding,
    clothingSegmentCategories,
  } = params;

  if (endpoint.api_style === "comfyui") {
    const imageGenerationOptions = {
      mode: "image",
      prompt,
      aspectRatio,
      referenceImages,
      referenceImageDataUrl,
      inpaint,
      maskPrompt,
      seed,
      inpaintMaskMode,
      inpaintMode,
      inpaintPreset,
      outpaint,
      outpaintStrategy,
      outpaintAmount,
      outpaintOverlap,
      outpaintZoomScale,
      inpaintExtendDirection,
      inpaintExtendPixels,
      inpaintExtendGrow,
      inpaintExtendFeather,
      inpaintExtendPadding,
      clothingSegmentCategories,
    } satisfies ComfyUiGenerationOptions;
    let comfyUiResult: ComfyUiGenerationResponse;
    try {
      comfyUiResult = await generateWithComfyUi(endpoint, apiKey, imageGenerationOptions);
    } catch (error) {
      const canRetryWithoutParser =
        inpaint === true &&
        shouldUseComfyUiClothingParser(imageGenerationOptions) &&
        error instanceof Error &&
        /timed out/i.test(error.message);
      if (!canRetryWithoutParser) {
        throw error;
      }

      const isClothingMaskRequest = isComfyUiClothingMaskPrompt(imageGenerationOptions.maskPrompt);
      const retryOptions = isClothingMaskRequest
        ? {
            ...imageGenerationOptions,
            disableClothingParser: true,
            maskPrompt: "clothing",
            maskThreshold: 0.34,
            maskGrow: 8,
            maskFeather: 4,
          }
        : {
            ...imageGenerationOptions,
            disableClothingParser: true,
          };

      log.warn(
        `ComfyUI run timed out with clothing parser enabled; retrying once with clothing parser disabled${
          isClothingMaskRequest ? " and broadened clothing mask settings" : ""
        }.`,
      );
      comfyUiResult = await generateWithComfyUi(endpoint, apiKey, retryOptions);
    }

    let { files, seed: comfyUiSeed } = comfyUiResult;
    const includeDiagnostics = inpaint === true;
    let diagnosticFiles = includeDiagnostics ? files.filter(isComfyUiDiagnosticAsset) : [];
    let imageFiles = files.filter((file) => !isComfyUiDiagnosticAsset(file));
    let firstFile = imageFiles[0];
    if (!firstFile) {
      const outputList = describeComfyUiAssets(files);
      throw new Error(
        `ComfyUI workflow returned only diagnostic image outputs and no final image output.${
          outputList ? ` Returned files: ${outputList}` : ""
        }`,
      );
    }
    const imageBuffer = await downloadComfyUiAsset(endpoint, apiKey, firstFile);
    const usedTintReference = shouldUseComfyUiMaskedTintReference(imageGenerationOptions);
    const diagnosticOptions = {
      mode: "image" as const,
      prompt,
      aspectRatio,
      referenceImages,
      referenceImageDataUrl,
      inpaint,
      maskPrompt,
      seed,
      inpaintMaskMode,
      inpaintMode,
      inpaintPreset,
      outpaint,
      outpaintStrategy,
      outpaintAmount,
      outpaintOverlap,
      outpaintZoomScale,
      inpaintExtendDirection,
      inpaintExtendPixels,
      inpaintExtendGrow,
      inpaintExtendFeather,
      inpaintExtendPadding,
      clothingSegmentCategories,
    };
    const diagnosticMaskMode = normalizeComfyUiMaskMode(inpaintMaskMode);
    const diagnosticInpaintSettings = resolveComfyUiEffectiveInpaintSettings(
      resolveComfyUiInpaintSettings(diagnosticOptions),
      inpaint === true,
      diagnosticMaskMode,
    );
    const diagnosticProtectionSettings = resolveComfyUiMaskProtectionSettings({
      ...diagnosticOptions,
      inpaint: inpaint === true,
    });
    const diagnosticReferenceDenoise = resolveComfyUiEffectiveDenoise(
      diagnosticOptions,
      inpaint === true,
      diagnosticMaskMode,
    );
    const diagnosticMaskContent = resolveComfyUiInpaintMaskContent(
      diagnosticOptions,
      inpaint === true,
      diagnosticMaskMode,
    );
    const diagnosticDifferentialDiffusion = shouldUseComfyUiDifferentialDiffusion(diagnosticOptions);
    const diagnosticUseRmbgBackgroundMask = shouldUseComfyUiRmbgBackgroundMask(diagnosticOptions);
    const diagnosticDifferentialDiffusionStrength = clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_DIFFERENTIAL_DIFFUSION_STRENGTH") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_DIFFERENTIAL_DIFFUSION_STRENGTH") ??
        1,
      0,
      1,
    );
    const diagnosticUseClothingParser = shouldUseComfyUiClothingParser(diagnosticOptions);
    const diagnosticUseClothingParserTarget =
      diagnosticUseClothingParser && isComfyUiClothingMaskPrompt(diagnosticOptions.maskPrompt);
    const diagnosticUseClothingParserHairTarget = shouldUseComfyUiClothingParserHairTarget(diagnosticOptions);
    const diagnosticUseClothingParserProtection =
      diagnosticUseClothingParser &&
      isComfyUiHairMaskPrompt(diagnosticOptions.maskPrompt) &&
      shouldUseComfyUiClothingParserProtection(diagnosticOptions);
    const diagnosticClothingSegmentCategories = resolveComfyUiClothingSegmentCategories(diagnosticOptions).join(",");
    const diagnosticUseSubtractionProtection = diagnosticProtectionSettings.enabled;
    const diagnosticSubtractClothingMask =
      diagnosticUseSubtractionProtection &&
      (readOptionalBooleanEnv("COMFYUI_INPAINT_SUBTRACT_CLOTHING_MASK") ??
        readOptionalBooleanEnv("COMFYUI_INPAINT_SUBTRACT_BODY_MASK") ??
        readOptionalBooleanEnv("ANIMA3_INPAINT_SUBTRACT_CLOTHING_MASK") ??
        readOptionalBooleanEnv("ANIMA3_INPAINT_SUBTRACT_BODY_MASK") ??
        true);
    const diagnosticMaskedTintBlend = clampNumber(
      readOptionalNumberEnv("COMFYUI_INPAINT_MASKED_TINT_BLEND") ??
        readOptionalNumberEnv("ANIMA3_INPAINT_MASKED_TINT_BLEND") ??
        0.28,
      0,
      1,
    );
    const diagnosticOutpaint = isComfyUiOutpaint(diagnosticOptions);
    if (diagnosticOutpaint) {
      diagnosticFiles = diagnosticFiles.filter((file) => file.filename.toLowerCase().includes("_outpaint"));
    }
    const diagnosticOutpaintPixels = resolveComfyUiOutpaintPixels(diagnosticOptions);
    const diagnosticSourceDimensions = buildComfyUiDimensions(diagnosticOptions);
    const diagnosticOutpaintDirection = normalizeComfyUiExtendDirection(inpaintExtendDirection);
    const diagnosticOutputDimensions = diagnosticOutpaint
      ? buildComfyUiOutpaintDimensions(
          diagnosticOptions,
          diagnosticSourceDimensions,
          diagnosticOutpaintDirection,
          diagnosticOutpaintPixels,
        )
      : diagnosticSourceDimensions;
    const diagnosticOutpaintLayout = diagnosticOutpaint
      ? buildComfyUiOutpaintLayout(
          diagnosticOptions,
          diagnosticSourceDimensions,
          diagnosticOutputDimensions,
          diagnosticOutpaintDirection,
        )
      : null;
    const diagnosticWorkflowOutpaintFactors = getComfyUiLayoutOutpaintFactors(
      diagnosticOutpaintLayout,
      diagnosticOutputDimensions,
      diagnosticOutpaintDirection,
      diagnosticOutpaint,
      diagnosticOutpaintPixels,
    );
    const finalImageMetadata = await sharp(imageBuffer).metadata().catch(() => null);
    const finalImageWidth = finalImageMetadata?.width ?? null;
    const finalImageHeight = finalImageMetadata?.height ?? null;
    if (
      diagnosticOutpaint &&
      finalImageWidth !== null &&
      finalImageHeight !== null &&
      (finalImageWidth < diagnosticOutputDimensions.width || finalImageHeight < diagnosticOutputDimensions.height)
    ) {
      throw new Error(
        `ComfyUI outpaint returned a non-expanded final image (${finalImageWidth}x${finalImageHeight}); expected about ${diagnosticOutputDimensions.width}x${diagnosticOutputDimensions.height}. Check that the active workflow routes TOMORI_OUTPAINT to the expanded outpaint decode before SaveImage.`,
      );
    }
    const diagnosticRequestedMaskPrompt = maskPrompt?.trim() || prompt;
    const diagnosticWorkflowMaskPrompt = resolveComfyUiWorkflowMaskPrompt(
      diagnosticRequestedMaskPrompt,
      diagnosticMaskMode,
      prompt,
    );
    const diagnosticOutpaintPadLeft = diagnosticOutpaintLayout?.placedSourceX ?? 0;
    const diagnosticOutpaintPadTop = diagnosticOutpaintLayout?.placedSourceY ?? 0;
    const diagnosticOutpaintPadRight = diagnosticOutpaintLayout
      ? Math.max(
          0,
          diagnosticOutputDimensions.width -
            diagnosticOutpaintLayout.placedSourceX -
            diagnosticOutpaintLayout.placedSourceWidth,
        )
      : 0;
    const diagnosticOutpaintPadBottom = diagnosticOutpaintLayout
      ? Math.max(
          0,
          diagnosticOutputDimensions.height -
            diagnosticOutpaintLayout.placedSourceY -
            diagnosticOutpaintLayout.placedSourceHeight,
        )
      : 0;
    const diagnosticLargestOutpaintPad = Math.max(
      diagnosticOutpaintPadLeft,
      diagnosticOutpaintPadTop,
      diagnosticOutpaintPadRight,
      diagnosticOutpaintPadBottom,
    );
    const diagnosticOutpaintPadFeather =
      diagnosticLargestOutpaintPad > 0
        ? Math.min(resolveComfyUiOutpaintPadFeather(), diagnosticLargestOutpaintPad)
        : 0;
    const diagnosticDetails = [
      `mask_prompt=${JSON.stringify(diagnosticWorkflowMaskPrompt)}`,
      ...(diagnosticWorkflowMaskPrompt !== diagnosticRequestedMaskPrompt
        ? [`requested_mask_prompt=${JSON.stringify(diagnosticRequestedMaskPrompt)}`]
        : []),
      `seed=${comfyUiSeed}`,
      `mask_mode=${diagnosticMaskMode}`,
      `preset=${inferComfyUiInpaintPreset(diagnosticOptions)}`,
      `mode=${normalizeComfyUiInpaintMode(diagnosticOptions)}`,
      `outpaint=${diagnosticOutpaint}`,
      ...(diagnosticOutpaintLayout
        ? [
            `outpaint_strategy=${diagnosticOutpaintLayout.strategy}`,
            `outpaint_amount=${resolveComfyUiOutpaintAmount(diagnosticOptions)}`,
            `outpaint_source_scale=${diagnosticOutpaintLayout.sourceScale}`,
            `outpaint_overlap=${diagnosticOutpaintLayout.overlap}`,
            "outpaint_preserve=center_source",
            "outpaint_background_preserve=edge_context",
            `outpaint_pad=${diagnosticOutpaintPadLeft}/${diagnosticOutpaintPadTop}/${diagnosticOutpaintPadRight}/${diagnosticOutpaintPadBottom}`,
            `outpaint_pad_feather=${diagnosticOutpaintPadFeather}`,
            `outpaint_blend_feather=${resolveComfyUiOutpaintBlendFeather()}`,
            `outpaint_center_preserve_feather=${resolveComfyUiOutpaintCenterPreserveFeather()}`,
            "outpaint_underpaint=blurred_source_guide",
            `outpaint_guide_blur=${resolveComfyUiOutpaintGuideBlurRadius()}/${resolveComfyUiOutpaintGuideBlurSigma()}`,
            `outpaint_denoise=${resolveComfyUiOutpaintDenoise()}`,
            `outpaint_extend_factors=${diagnosticWorkflowOutpaintFactors.up}/${diagnosticWorkflowOutpaintFactors.down}/${diagnosticWorkflowOutpaintFactors.left}/${diagnosticWorkflowOutpaintFactors.right}`,
            `outpaint_source_placement=${diagnosticOutpaintLayout.placedSourceX}x${diagnosticOutpaintLayout.placedSourceY}+${diagnosticOutpaintLayout.placedSourceWidth}x${diagnosticOutpaintLayout.placedSourceHeight}`,
            `outpaint_mask_source_rect=${diagnosticOutpaintLayout.maskSourceX}x${diagnosticOutpaintLayout.maskSourceY}+${diagnosticOutpaintLayout.maskSourceWidth}x${diagnosticOutpaintLayout.maskSourceHeight}`,
          ]
        : []),
      `outpaint_pixels=${diagnosticOutpaintPixels}`,
      `source_size=${diagnosticSourceDimensions.width}x${diagnosticSourceDimensions.height}`,
      `expected_output_size=${diagnosticOutputDimensions.width}x${diagnosticOutputDimensions.height}`,
      `final_output_size=${finalImageWidth ?? "unknown"}x${finalImageHeight ?? "unknown"}`,
      `mask_content=${diagnosticMaskContent}`,
      `differential_diffusion=${diagnosticDifferentialDiffusion}`,
      `differential_diffusion_strength=${diagnosticDifferentialDiffusionStrength}`,
      `rmbg_background_mask=${diagnosticUseRmbgBackgroundMask}`,
      `rmbg_model=${JSON.stringify(
        readOptionalStringEnv("COMFYUI_RMBG_MODEL") ?? readOptionalStringEnv("ANIMA3_RMBG_MODEL") ?? "RMBG-2.0",
      )}`,
      `clothing_parser=${diagnosticUseClothingParser}`,
      `clothing_parser_target=${diagnosticUseClothingParserTarget}`,
      `clothing_parser_hair_target=${diagnosticUseClothingParserHairTarget}`,
      `clothing_parser_protection=${diagnosticUseClothingParserProtection}`,
      `clothing_segment_categories=${JSON.stringify(diagnosticClothingSegmentCategories)}`,
      `masked_tint_reference=${usedTintReference}`,
      `masked_tint_blend=${diagnosticMaskedTintBlend}`,
      `subtract_face_mask=${diagnosticUseSubtractionProtection}`,
      ...(diagnosticProtectionSettings.enabled
        ? [
            `face_mask_prompt=${JSON.stringify(diagnosticProtectionSettings.maskPrompt)}`,
            `face_threshold=${diagnosticProtectionSettings.maskThreshold}`,
            `face_grow=${diagnosticProtectionSettings.maskGrow}`,
            `face_feather=${diagnosticProtectionSettings.maskFeather}`,
            `subtract_body_mask=${diagnosticSubtractClothingMask}`,
            `subtract_clothing_mask=${diagnosticSubtractClothingMask}`,
            `clothing_mask_prompt=${JSON.stringify(diagnosticProtectionSettings.clothingMaskPrompt)}`,
            `clothing_threshold=${diagnosticProtectionSettings.clothingMaskThreshold}`,
            `clothing_grow=${diagnosticProtectionSettings.clothingMaskGrow}`,
            `clothing_feather=${diagnosticProtectionSettings.clothingMaskFeather}`,
            `arms_mask_prompt=${JSON.stringify(diagnosticProtectionSettings.armsMaskPrompt)}`,
            `arms_threshold=${diagnosticProtectionSettings.armsMaskThreshold}`,
            `arms_grow=${diagnosticProtectionSettings.armsMaskGrow}`,
            `arms_feather=${diagnosticProtectionSettings.armsMaskFeather}`,
            `neck_mask_prompt=${JSON.stringify(diagnosticProtectionSettings.neckMaskPrompt)}`,
            `neck_threshold=${diagnosticProtectionSettings.neckMaskThreshold}`,
            `neck_grow=${diagnosticProtectionSettings.neckMaskGrow}`,
            `neck_feather=${diagnosticProtectionSettings.neckMaskFeather}`,
            `subtract_skin_mask=${diagnosticUseSubtractionProtection}`,
            `skin_mask_prompt=${JSON.stringify(diagnosticProtectionSettings.skinMaskPrompt)}`,
            `skin_threshold=${diagnosticProtectionSettings.skinMaskThreshold}`,
            `skin_grow=${diagnosticProtectionSettings.skinMaskGrow}`,
            `skin_feather=${diagnosticProtectionSettings.skinMaskFeather}`,
            "subtract_legs_mask=false",
            "subtract_feet_mask=false",
          ]
        : []),
      `extend_direction=${normalizeComfyUiExtendDirection(inpaintExtendDirection)}`,
      `threshold=${diagnosticInpaintSettings.maskThreshold}`,
      `grow=${diagnosticInpaintSettings.maskGrow}`,
      `feather=${diagnosticInpaintSettings.maskFeather}`,
      `extend_pixels=${diagnosticInpaintSettings.extendPixels}`,
      `extend_padding=${diagnosticInpaintSettings.extendPadding}`,
      `cfg=${diagnosticInpaintSettings.cfg}`,
      `denoise=${diagnosticReferenceDenoise}`,
    ].join(", ");
    const diagnosticImages = await Promise.all(
      diagnosticFiles.map(async (file) => {
        const diagnosticBuffer = await downloadComfyUiAsset(endpoint, apiKey, file);
        const label = `${diagnosticOutpaint ? "Outpaint" : "Inpaint"} ${getComfyUiDiagnosticLabel(file).toLowerCase()}`;
        return {
          label,
          imageData: diagnosticBuffer.toString("base64"),
          mimeType: "image/png",
          filename: file.filename,
          details: diagnosticDetails,
        };
      }),
    );
    return {
      imageData: imageBuffer.toString("base64"),
      mimeType: "image/png",
      ...(diagnosticImages.length > 0 ? { diagnosticImages } : {}),
    };
  }

  const response = await fetchUserRemoteUrl(`${endpoint.endpoint_url.replace(/\/+$/, "")}/images/generations`, {
    method: "POST",
    headers: buildCustomHeaders(apiKey),
    body: JSON.stringify({
      model: endpoint.model_name,
      prompt,
      size: aspectRatio,
      ...(referenceImages?.length ? { reference_images: referenceImages } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Custom image generation failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
  };

  return {
    imageData: payload.data?.[0]?.b64_json ?? null,
    mimeType: "image/png",
  };
}

export async function generateCustomVideoViaEndpoint(params: {
  endpoint: CustomEndpointRow;
  apiKey: string;
  prompt: string;
  aspectRatio?: string;
  durationSeconds?: number;
  resolution?: string;
  referenceImages?: ProviderNativeVideoGenerationRequest["referenceImages"];
  generateAudio?: boolean;
}): Promise<ProviderNativeVideoGenerationResult> {
  const { endpoint, apiKey, prompt, aspectRatio, durationSeconds, resolution, referenceImages, generateAudio } = params;

  if (endpoint.api_style === "comfyui") {
    const { files } = await generateWithComfyUi(endpoint, apiKey, {
      mode: "video",
      prompt,
      aspectRatio,
      durationSeconds,
      resolution,
      referenceImages,
      generateAudio,
    });
    const firstFile = files[0];
    const videoBuffer = await downloadComfyUiAsset(endpoint, apiKey, firstFile);
    return {
      videoData: videoBuffer,
      mimeType: "video/mp4",
    };
  }

  const response = await fetchUserRemoteUrl(`${endpoint.endpoint_url.replace(/\/+$/, "")}/videos/generations`, {
    method: "POST",
    headers: buildCustomHeaders(apiKey),
    body: JSON.stringify({
      model: endpoint.model_name,
      prompt,
      aspect_ratio: aspectRatio,
      duration: durationSeconds,
      resolution,
      ...(referenceImages?.length ? { reference_images: referenceImages } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Custom video generation failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
  };
  const base64Data = payload.data?.[0]?.b64_json ?? null;

  return {
    videoData: base64Data ? Buffer.from(base64Data, "base64") : null,
    mimeType: "video/mp4",
  };
}
