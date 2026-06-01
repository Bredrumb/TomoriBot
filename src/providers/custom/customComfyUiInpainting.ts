export type ComfyUiInpaintMaskContent = "fill" | "latent_noise";
export type ComfyUiInpaintMode = "normal" | "extend" | "outpaint";
export type ComfyUiClothingSegmentCategory =
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

export type ComfyUiInpaintSettings = {
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

export type ComfyUiMaskProtectionSettings = {
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

export type ComfyUiInpaintOptions = {
  mode: "image" | "video";
  prompt: string;
  inpaint?: boolean;
  maskPrompt?: string | null;
  maskThreshold?: number | null;
  maskGrow?: number | null;
  maskFeather?: number | null;
  cfg?: number | null;
  denoise?: number | null;
  referenceDenoise?: number | null;
  inpaintMaskMode?: string | null;
  inpaintMode?: string | null;
  inpaintPreset?: string | null;
  outpaint?: boolean | null;
  inpaintExtendPixels?: number | null;
  inpaintExtendGrow?: number | null;
  inpaintExtendFeather?: number | null;
  inpaintExtendPadding?: number | null;
  clothingMode?: boolean | null;
  clothingSegmentCategories?: string[] | null;
  disableClothingParser?: boolean;
};

export type ComfyUiClothingSegmentSelection = Record<ComfyUiClothingSegmentCategory, boolean>;

export const DEFAULT_COMFYUI_REFERENCE_DENOISE = 0.75;

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

function normalizeComfyUiInpaintPreset(preset: string | null | undefined): string | null {
  const normalized =
    preset
      ?.trim()
      .toLowerCase()
      .replace(/[-\s]+/g, "_") ?? "";
  if (!normalized) {
    return null;
  }
  if (normalized in COMFYUI_INPAINT_PRESETS) {
    return normalized;
  }

  if (normalized === "object_recolor" || normalized === "hair_recolor") {
    return "tight_recolor";
  }
  if (normalized === "garment_recolor") {
    return "broad_recolor";
  }

  return null;
}

export function isComfyUiEyeMaskPrompt(maskPrompt: string | null | undefined): boolean {
  return /\b(?:eye|eyes|iris|irises|pupil|pupils)\b/i.test(maskPrompt ?? "");
}

export function isComfyUiHairMaskPrompt(maskPrompt: string | null | undefined): boolean {
  return /\b(?:hair|bangs|fringe|ponytail|braid|braids|pigtail|pigtails|hairstyle|locks|strands)\b/i.test(
    maskPrompt ?? "",
  );
}

export function isComfyUiClothingMaskPrompt(maskPrompt: string | null | undefined): boolean {
  return /\b(?:shirt|top|blouse|camisole|tank\s*top|hoodie|cardigan|sweater|jacket|coat|dress|skirt|pants|trousers|jeans|leggings|shorts|uniform|outfit|clothes|clothing|garment|apparel|fabric|hat|cap|helmet|glasses|sunglasses|belt|bag|purse|backpack|scarf|shawl|shoe|shoes|boot|boots|sneaker|sneakers|sock|socks|stocking|stockings|tights|glove|gloves|earring|earrings|jewelry|jewellery|necklace|choker|bracelet|ring|rings|bow|ribbon|hairpin|accessory|accessories)\b/i.test(
    maskPrompt ?? "",
  );
}

export function normalizeComfyUiInpaintMode(
  modeOrOptions: string | null | undefined | Pick<ComfyUiInpaintOptions, "inpaintMode" | "outpaint">,
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

export function normalizeComfyUiMaskMode(mode: string | null | undefined): "target" | "background" {
  return mode?.trim().toLowerCase() === "background" ? "background" : "target";
}

export function inferComfyUiInpaintPreset(options: ComfyUiInpaintOptions): string {
  const isHairRequest =
    isComfyUiHairMaskPrompt(options.maskPrompt) ||
    /\b(?:hair|bangs|fringe|ponytail|braid|braids|pigtail|pigtails)\b/i.test(options.prompt);
  const isClothingRequest = options.clothingMode === true || isComfyUiClothingMaskPrompt(options.maskPrompt);
  const explicitPreset = normalizeComfyUiInpaintPreset(options.inpaintPreset);
  if (explicitPreset) {
    if (isHairRequest && explicitPreset === "tight_recolor") {
      return "broad_recolor";
    }
    return explicitPreset;
  }

  if (normalizeComfyUiMaskMode(options.inpaintMaskMode) === "background") {
    return "background";
  }
  if (normalizeComfyUiInpaintMode(options) !== "normal") {
    return "extend";
  }
  if (isClothingRequest) {
    return "broad_recolor";
  }

  const promptText = `${options.prompt} ${options.maskPrompt ?? ""}`.toLowerCase();
  if (
    /\b(?:dress|shirt|skirt|pants|coat|jacket|hoodie|cardigan|sweater|uniform|outfit|clothes|clothing|garment|apparel|fabric|hat|cap|helmet|glasses|sunglasses|belt|bag|purse|backpack|scarf|shawl|shoe|shoes|boot|boots|sneaker|sneakers|sock|socks|stocking|stockings|tights|glove|gloves|earring|earrings|jewelry|jewellery|necklace|choker|bracelet|ring|rings|bow|ribbon|hairpin|accessory|accessories)\b/.test(
      promptText,
    )
  ) {
    return "broad_recolor";
  }
  if (/\b(?:hair|bangs|fringe|ponytail|braid|braids|pigtail|pigtails)\b/.test(promptText)) {
    return "broad_recolor";
  }
  if (
    /\b(?:color|colour|recolor|recolour|red|blue|green|yellow|pink|purple|black|white|brown|orange|cyan|teal)\b/.test(
      promptText,
    )
  ) {
    return "broad_recolor";
  }
  if (/\b(?:eye|eyes|button|buttons|logo|badge|gem|jewel|earring|ring|small|tiny)\b/.test(promptText)) {
    return "tight_recolor";
  }

  return "broad_recolor";
}

export function normalizeComfyUiClothingSegmentCategory(
  category: string | null | undefined,
): ComfyUiClothingSegmentCategory | null {
  const normalized =
    category
      ?.trim()
      .toLowerCase()
      .replace(/[_\s]+/g, "-") ?? "";
  const categoryMap: Record<string, ComfyUiClothingSegmentCategory> = {
    hat: "Hat",
    cap: "Hat",
    helmet: "Hat",
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
    dress: "Dress",
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
    shoe: "Left-shoe",
    shoes: "Left-shoe",
    boot: "Left-shoe",
    boots: "Left-shoe",
    sneaker: "Left-shoe",
    sneakers: "Left-shoe",
    purse: "Bag",
    backpack: "Bag",
    shawl: "Scarf",
    background: "Background",
  };

  return categoryMap[normalized] ?? null;
}

export function hasExplicitComfyUiClothingSegmentCategories(options: ComfyUiInpaintOptions): boolean {
  return (options.clothingSegmentCategories ?? []).some(
    (category) => normalizeComfyUiClothingSegmentCategory(category) !== null,
  );
}

export function shouldUseComfyUiClothingParserTarget(options: ComfyUiInpaintOptions): boolean {
  if (options.clothingMode === false) {
    return false;
  }

  return (
    options.clothingMode === true ||
    isComfyUiClothingMaskPrompt(options.maskPrompt) ||
    hasExplicitComfyUiClothingSegmentCategories(options)
  );
}

export function createComfyUiClothingSegmentSelection(
  enabledCategories: ComfyUiClothingSegmentCategory[],
): ComfyUiClothingSegmentSelection {
  return Object.fromEntries(
    COMFYUI_CLOTHING_SEGMENT_CATEGORIES.map((category) => [category, enabledCategories.includes(category)]),
  ) as ComfyUiClothingSegmentSelection;
}

export function resolveComfyUiClothingSegmentCategories(
  options: ComfyUiInpaintOptions,
): ComfyUiClothingSegmentCategory[] {
  const maskPrompt = options.maskPrompt?.toLowerCase() ?? "";
  const promptNamesDress = /\bdress\b/.test(maskPrompt);
  const addDressParts = (categories: Set<ComfyUiClothingSegmentCategory>) => {
    categories.add("Dress");
    categories.add("Upper-clothes");
    categories.add("Skirt");
  };

  const explicitCategories = (options.clothingSegmentCategories ?? [])
    .map(normalizeComfyUiClothingSegmentCategory)
    .filter((category): category is ComfyUiClothingSegmentCategory => category !== null);
  if (explicitCategories.length > 0) {
    const categories = new Set(explicitCategories);
    if (promptNamesDress) {
      addDressParts(categories);
    }
    if (categories.has("Left-shoe")) {
      categories.add("Right-shoe");
    }
    return [...categories];
  }

  const categories = new Set<ComfyUiClothingSegmentCategory>();
  const addUpperClothes = () => categories.add("Upper-clothes");
  const addBroadClothing = () => {
    for (const category of [
      "Hat",
      "Sunglasses",
      "Upper-clothes",
      "Skirt",
      "Dress",
      "Belt",
      "Pants",
      "Bag",
      "Scarf",
      "Left-shoe",
      "Right-shoe",
    ]) {
      categories.add(category as ComfyUiClothingSegmentCategory);
    }
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
  if (promptNamesDress) {
    addDressParts(categories);
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

export function normalizeComfyUiTargetMaskPrompt(maskPrompt: string): string {
  const normalized = maskPrompt.trim();
  if (isComfyUiHairMaskPrompt(normalized)) {
    return "hair";
  }
  if (isComfyUiEyeMaskPrompt(normalized)) {
    return "both eyes";
  }
  return normalized;
}

export function isComfyUiBackgroundMaskPrompt(maskPrompt: string): boolean {
  return /\b(?:background|backdrop|surroundings|environment|scene|setting)\b/i.test(maskPrompt);
}

export function inferComfyUiForegroundMaskPrompt(prompt: string): string {
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

export function resolveComfyUiWorkflowMaskPrompt(
  maskPrompt: string,
  maskMode: "target" | "background",
  prompt: string,
): string {
  if (maskMode !== "background") {
    return normalizeComfyUiTargetMaskPrompt(maskPrompt);
  }
  return isComfyUiBackgroundMaskPrompt(maskPrompt) ? inferComfyUiForegroundMaskPrompt(prompt) : maskPrompt;
}

export function stripComfyUiHairRecolorPreservationClauses(
  prompt: string,
  maskPrompt: string | null | undefined,
): string {
  if (!isComfyUiHairMaskPrompt(maskPrompt)) {
    return prompt;
  }

  const hairShapeTerms = String.raw`(?:hair(?:style)?|haircut|braid|braids|bangs|fringe|parting|silhouette|shape|strand\s+layout)`;
  const optionalExisting = String.raw`(?:the\s+)?(?:existing\s+)?`;
  const joinedHairShapeTerms = String.raw`${optionalExisting}${hairShapeTerms}(?:\s+and\s+${optionalExisting}${hairShapeTerms})*`;
  const preserveClause = new RegExp(
    String.raw`\s*,?\s*(?:while\s+)?preserv(?:e|ing)\s+${joinedHairShapeTerms}\.?`,
    "gi",
  );
  const keepClause = new RegExp(String.raw`\s*,?\s*(?:keep|keeping)\s+${joinedHairShapeTerms}\.?`, "gi");

  return prompt
    .replace(preserveClause, "")
    .replace(keepClause, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*$/, "")
    .trim();
}

export function stripComfyUiNegativeInpaintClauses(prompt: string): string {
  return prompt
    .replace(/\s*,?\s*\b(?:not|no|without)\s+[^,.]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*$/, "")
    .trim();
}

export function strengthenComfyUiHairRecolorPrompt(prompt: string, maskPrompt: string | null | undefined): string {
  if (
    !isComfyUiHairMaskPrompt(maskPrompt) ||
    !/\b(?:color|colour|recolor|recolour|red|orange|yellow|green|blue|purple|pink|white|black|brown|blonde|grey|gray)\b/i.test(
      prompt,
    )
  ) {
    return prompt;
  }

  const shapeGuard =
    "hair dye only on existing source hair pixels, keep the exact original hair silhouette, length, part, bangs, volume, and strand layout, the masked region is hair only";

  if (
    /\b(?:dark|deep|near[-\s]?black|almost\s+black|blackish)\s+(?:purple|violet)\b|\b(?:purple|violet)\s+(?:near[-\s]?black|almost\s+black|blackish)\b/i.test(
      prompt,
    )
  ) {
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

function shouldSubtractComfyUiFaceMask(options: ComfyUiInpaintOptions): boolean {
  return (
    options.inpaint === true &&
    normalizeComfyUiMaskMode(options.inpaintMaskMode) === "target" &&
    normalizeComfyUiInpaintMode(options) === "normal" &&
    inferComfyUiInpaintPreset(options) !== "background" &&
    isComfyUiHairMaskPrompt(options.maskPrompt)
  );
}

export function resolveComfyUiMaskProtectionSettings(options: ComfyUiInpaintOptions): ComfyUiMaskProtectionSettings {
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
    maskThreshold: 0.42,
    maskGrow: 2,
    maskFeather: 1,
    clothingMaskPrompt:
      "clothes, dress, shirt, top, jacket, coat, hoodie, sweater, cardigan, skirt, pants, trousers, shorts, uniform",
    clothingMaskThreshold: 0.42,
    clothingMaskGrow: 12,
    clothingMaskFeather: 6,
    armsMaskPrompt: "arms",
    armsMaskThreshold: 0.42,
    armsMaskGrow: 2,
    armsMaskFeather: 1,
    neckMaskPrompt: "neck",
    neckMaskThreshold: 0.36,
    neckMaskGrow: 4,
    neckMaskFeather: 2,
    skinMaskPrompt: "shoulders",
    skinMaskThreshold: 0.42,
    skinMaskGrow: 1,
    skinMaskFeather: 1,
    legsMaskPrompt: "legs",
    legsMaskThreshold: 0.42,
    legsMaskGrow: 1,
    legsMaskFeather: 1,
    feetMaskPrompt: "feet",
    feetMaskThreshold: 0.42,
    feetMaskGrow: 1,
    feetMaskFeather: 1,
  };
}

export function resolveComfyUiInpaintMaskContent(
  options: ComfyUiInpaintOptions,
  inpaint: boolean,
  maskMode: string,
): ComfyUiInpaintMaskContent {
  void options;
  void inpaint;
  void maskMode;
  return "fill";
}

export function resolveComfyUiInpaintSettings(options: ComfyUiInpaintOptions): ComfyUiInpaintSettings {
  const inferredPreset = inferComfyUiInpaintPreset(options);
  const preset = COMFYUI_INPAINT_PRESETS[inferredPreset] ?? DEFAULT_COMFYUI_INPAINT_SETTINGS;
  const eyeMaskPrompt = isComfyUiEyeMaskPrompt(options.maskPrompt);
  const hairMaskPrompt = isComfyUiHairMaskPrompt(options.maskPrompt);
  const clothingMaskPrompt = shouldUseComfyUiClothingParserTarget(options);
  const inpaintMode = normalizeComfyUiInpaintMode(options);

  const baseMaskThreshold = clampNumber(options.maskThreshold ?? preset.maskThreshold, 0, 1);
  const baseMaskGrow = clampNumber(options.maskGrow ?? preset.maskGrow, 0, 128);
  const baseMaskFeather = clampNumber(options.maskFeather ?? preset.maskFeather, 0, 100);

  const eyeMaskAdjustments =
    inferredPreset === "tight_recolor" && eyeMaskPrompt
      ? {
          maskThreshold: Math.min(baseMaskThreshold, 0.42),
          maskGrow: Math.max(baseMaskGrow, 8),
          maskFeather: Math.max(baseMaskFeather, 4),
        }
      : null;
  const hairRecolorAdjustments =
    inferredPreset !== "background" && hairMaskPrompt && inpaintMode !== "extend"
      ? {
          maskThreshold: Math.min(baseMaskThreshold, 0.38),
          maskGrow: Math.max(baseMaskGrow, 9),
          maskFeather: Math.max(baseMaskFeather, 7),
          cfg: 5,
          referenceDenoise: 0.84,
        }
      : null;
  const clothingRecolorAdjustments =
    inferredPreset === "broad_recolor" && clothingMaskPrompt && inpaintMode !== "extend"
      ? {
          maskThreshold: Math.min(baseMaskThreshold, 0.42),
          maskGrow: Math.max(baseMaskGrow, 12),
          maskFeather: Math.max(baseMaskFeather, 6),
          cfg: 8,
          referenceDenoise: 0.78,
        }
      : null;
  const broadStructureRecolorAdjustments =
    inferredPreset === "broad_recolor" && !clothingMaskPrompt && !hairMaskPrompt && inpaintMode !== "extend"
      ? { cfg: 6, referenceDenoise: 0.68 }
      : null;
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

  return {
    maskThreshold:
      hairExtendAdjustments?.maskThreshold ??
      clothingRecolorAdjustments?.maskThreshold ??
      hairRecolorAdjustments?.maskThreshold ??
      eyeMaskAdjustments?.maskThreshold ??
      baseMaskThreshold,
    maskGrow:
      hairExtendAdjustments?.maskGrow ??
      clothingRecolorAdjustments?.maskGrow ??
      hairRecolorAdjustments?.maskGrow ??
      eyeMaskAdjustments?.maskGrow ??
      baseMaskGrow,
    maskFeather:
      hairExtendAdjustments?.maskFeather ??
      clothingRecolorAdjustments?.maskFeather ??
      hairRecolorAdjustments?.maskFeather ??
      eyeMaskAdjustments?.maskFeather ??
      baseMaskFeather,
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
      hairExtendAdjustments?.extendPixels ?? options.inpaintExtendPixels ?? preset.extendPixels,
      0,
      512,
    ),
    extendGrow: clampNumber(
      hairExtendAdjustments?.extendGrow ?? options.inpaintExtendGrow ?? preset.extendGrow,
      0,
      256,
    ),
    extendFeather: clampNumber(
      hairExtendAdjustments?.extendFeather ?? options.inpaintExtendFeather ?? preset.extendFeather,
      0,
      100,
    ),
    extendPadding: clampNumber(
      hairExtendAdjustments?.extendPadding ?? options.inpaintExtendPadding ?? preset.extendPadding,
      0,
      256,
    ),
  };
}

export function resolveComfyUiEffectiveInpaintSettings(
  settings: ComfyUiInpaintSettings,
  inpaint: boolean,
  maskMode: "target" | "background",
): ComfyUiInpaintSettings {
  if (!inpaint || maskMode !== "background") {
    return settings;
  }

  return {
    ...settings,
    maskThreshold: Math.min(settings.maskThreshold, 0.4),
    maskGrow: 0,
    maskFeather: 0,
  };
}

export function shouldUseComfyUiDifferentialDiffusion(options: ComfyUiInpaintOptions): boolean {
  return (
    options.mode === "image" &&
    options.inpaint === true &&
    normalizeComfyUiMaskMode(options.inpaintMaskMode) === "target" &&
    normalizeComfyUiInpaintMode(options) === "normal" &&
    inferComfyUiInpaintPreset(options) !== "background" &&
    (shouldUseComfyUiClothingParserTarget(options) || isComfyUiHairMaskPrompt(options.maskPrompt))
  );
}

export function shouldUseComfyUiClothingParser(options: ComfyUiInpaintOptions): boolean {
  if (options.disableClothingParser || options.clothingMode === false) {
    return false;
  }

  const explicitClothingCategories = hasExplicitComfyUiClothingSegmentCategories(options);

  return (
    options.mode === "image" &&
    options.inpaint === true &&
    normalizeComfyUiMaskMode(options.inpaintMaskMode) === "target" &&
    normalizeComfyUiInpaintMode(options) === "normal" &&
    inferComfyUiInpaintPreset(options) !== "background" &&
    (options.clothingMode === true ||
      explicitClothingCategories ||
      shouldUseComfyUiClothingParserTarget(options) ||
      (isComfyUiHairMaskPrompt(options.maskPrompt) && !explicitClothingCategories))
  );
}

export function shouldUseComfyUiClothingParserHairTarget(_options: ComfyUiInpaintOptions): boolean {
  return false;
}

export function shouldUseComfyUiClothingParserProtection(options: ComfyUiInpaintOptions): boolean {
  return (
    options.mode === "image" &&
    options.inpaint === true &&
    normalizeComfyUiMaskMode(options.inpaintMaskMode) === "target" &&
    normalizeComfyUiInpaintMode(options) === "normal" &&
    inferComfyUiInpaintPreset(options) !== "background" &&
    isComfyUiHairMaskPrompt(options.maskPrompt)
  );
}

export function shouldUseComfyUiRmbgBackgroundMask(options: ComfyUiInpaintOptions): boolean {
  return (
    options.mode === "image" &&
    options.inpaint === true &&
    normalizeComfyUiMaskMode(options.inpaintMaskMode) === "background" &&
    normalizeComfyUiInpaintMode(options) === "normal"
  );
}
