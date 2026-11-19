import JSZip from "jszip";
import { z } from "zod";
import { log } from "@/utils/misc/logger";
import { getDeclaredUncompressedSize, resolveZipEntryFile } from "@/utils/zip/zipEntryGuards";

const CHARX_CARD_NAME = "card.json";
const CHARX_EMBEDDED_URI_PREFIX = "embeded://";

// Prefix matching is used instead of equality so a V2 card in a .charx container still converts, matching the
// SillyTavern converter.
const CHARX_SPEC_PREFIX = "chara_card";

export type CharxReadLimits = {
  maxCardBytes: number;
  maxAssets: number;
  maxTotalAssetBytes: number;
};

export type CharxReadFailureReason =
  | "invalid_zip"
  | "missing_card"
  | "invalid_card"
  | "not_character_card"
  | "card_too_large"
  | "assets_too_large";

export type CharxReadResult =
  | {
      ok: true;
      card: unknown;
      // Only bundled archive entries are counted (excluding remote URLs and `ccdefault:` references), because
      // references carry no media to drop.
      ignoredAssetCount: number;
    }
  | {
      ok: false;
      reason: CharxReadFailureReason;
    };

// Unknown keys pass through and `spec` is optional because V3 requires ignoring unknown fields and V2 cards may omit
// `spec`.
const charxEnvelopeSchema = z
  .object({
    spec: z.string().optional(),
    spec_version: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const charxAssetSchema = z
  .object({
    type: z.string().optional(),
    uri: z.string().optional(),
  })
  .loose();

export async function readCharxCard(charxBuffer: Buffer, limits: CharxReadLimits): Promise<CharxReadResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(charxBuffer);
  } catch (error) {
    log.warn("Failed to load .charx archive zip", error);
    return { ok: false, reason: "invalid_zip" };
  }

  // Resolved by exact path first, so a `card.json` buried in the asset tree
  // cannot shadow the spec-mandated root file.
  const cardFile = resolveZipEntryFile(zip, CHARX_CARD_NAME);
  if (!cardFile) {
    return { ok: false, reason: "missing_card" };
  }

  // Measured before decompression: this is what refuses an honest zip bomb.
  const declaredSize = getDeclaredUncompressedSize(cardFile);
  if (declaredSize !== null && declaredSize > limits.maxCardBytes) {
    return { ok: false, reason: "card_too_large" };
  }

  let cardText: string;
  let cardJson: unknown;
  try {
    cardText = await cardFile.async("string");
    cardJson = JSON.parse(cardText);
  } catch (error) {
    log.warn("Failed to parse .charx card.json", error);
    return { ok: false, reason: "invalid_card" };
  }

  // Only a card that names a different format is refused here. An absent `spec`
  // is left to the converter, which recognizes root-level V2 cards without one;
  // refusing here would make the container stricter than the format it carries.
  const envelope = charxEnvelopeSchema.safeParse(cardJson);
  if (!envelope.success) {
    return { ok: false, reason: "invalid_card" };
  }
  const declaredSpec = envelope.data.spec;
  if (declaredSpec !== undefined && !declaredSpec.toLowerCase().startsWith(CHARX_SPEC_PREFIX)) {
    return { ok: false, reason: "not_character_card" };
  }

  // Backstop measuring the decompressed bytes, not a re-serialization of them:
  // whitespace and duplicate keys survive the former and vanish from the latter.
  // jszip already refuses an entry that delivers more than it declared, so this
  // covers a declared size that was simply absent.
  if (Buffer.byteLength(cardText, "utf8") > limits.maxCardBytes) {
    return { ok: false, reason: "card_too_large" };
  }

  const assets = inspectDeclaredAssets(zip, cardJson, limits);
  if (!assets.ok) {
    return { ok: false, reason: "assets_too_large" };
  }

  return { ok: true, card: cardJson, ignoredAssetCount: assets.ignoredAssetCount };
}

function inspectDeclaredAssets(
  zip: JSZip,
  cardJson: unknown,
  limits: CharxReadLimits,
): { ok: true; ignoredAssetCount: number } | { ok: false } {
  const cardData = (cardJson as { data?: unknown } | null)?.data;
  const rawAssets = (cardData as { assets?: unknown } | undefined)?.assets;
  if (!Array.isArray(rawAssets)) {
    return { ok: true, ignoredAssetCount: 0 };
  }

  // Checked against the raw list length, before any per-entry work: counting only
  // successfully parsed entries would let 400k junk values block the event loop
  // under a cap of 500, since each one would `continue` past the counter.
  if (rawAssets.length > limits.maxAssets) {
    return { ok: false };
  }

  let totalDeclaredBytes = 0;
  let ignoredAssetCount = 0;
  for (const rawAsset of rawAssets) {
    const asset = charxAssetSchema.safeParse(rawAsset);
    if (!asset.success) {
      continue;
    }

    const uri = asset.data.uri;
    if (!uri?.startsWith(CHARX_EMBEDDED_URI_PREFIX)) {
      continue;
    }

    const embeddedEntry = resolveEmbeddedAssetEntry(zip, uri.slice(CHARX_EMBEDDED_URI_PREFIX.length));
    if (!embeddedEntry) {
      continue;
    }

    ignoredAssetCount += 1;

    const declaredSize = getDeclaredUncompressedSize(embeddedEntry);
    if (declaredSize === null) {
      continue;
    }

    totalDeclaredBytes += declaredSize;
    if (totalDeclaredBytes > limits.maxTotalAssetBytes) {
      return { ok: false };
    }
  }

  return { ok: true, ignoredAssetCount };
}

function resolveEmbeddedAssetEntry(zip: JSZip, embeddedPath: string): JSZip.JSZipObject | null {
  if (!embeddedPath || embeddedPath.includes("..") || embeddedPath.startsWith("/") || embeddedPath.includes("\\")) {
    return null;
  }

  const entry = zip.file(embeddedPath);
  return entry && !entry.dir ? entry : null;
}
