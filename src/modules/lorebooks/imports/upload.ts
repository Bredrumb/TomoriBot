import { extractSillyTavernMetadataFromPNG } from "@/utils/image/pngMetadata";
import { readCharxCard } from "@/utils/persona/charxArchive";
import { IMPORT_LIMITS } from "@/utils/security/rateLimiter";
import { convertCharacterBook, extractCharacterBook, type LorebookConversion } from "./characterBook";
import { asSillyTavernObject, getSillyTavernString } from "./sillyTavernFields";
import { convertWorldInfoFile } from "./worldInfo";

export const LOREBOOK_IMPORT_MAX_FILE_MB = 2;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function lorebookCarrier(buffer: Uint8Array): "png" | "charx" | "json" {
  if (Buffer.from(buffer.subarray(0, PNG_SIGNATURE.length)).equals(PNG_SIGNATURE)) return "png";
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return "charx";
  return "json";
}

export function convertLorebookUpload(input: unknown): LorebookConversion | null {
  const root = asSillyTavernObject(input);
  if (!root) return null;
  if (Array.isArray(root.entries)) return convertCharacterBook(root);
  const book = extractCharacterBook(root);
  if (book) return convertCharacterBook(book);
  return convertWorldInfoFile(root);
}

export type LorebookUploadParseResult =
  | { ok: true; conversion: LorebookConversion; name?: string }
  | { ok: false; reason: "invalid_json" | "unsupported" | "no_book" }
  | { ok: false; reason: "too_large"; maxMB: number };

export async function parseLorebookUpload(buffer: Uint8Array): Promise<LorebookUploadParseResult> {
  const carrier = lorebookCarrier(buffer);
  const maxMB =
    carrier === "png"
      ? IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB
      : carrier === "charx"
        ? IMPORT_LIMITS.MAX_CHARX_IMPORT_SIZE_MB
        : LOREBOOK_IMPORT_MAX_FILE_MB;
  if (buffer.byteLength > maxMB * 1024 * 1024) return { ok: false, reason: "too_large", maxMB };
  let parsed: unknown;
  if (carrier === "png") {
    const metadata = extractSillyTavernMetadataFromPNG(Buffer.from(buffer));
    if (!metadata) return { ok: false, reason: "unsupported" };
    parsed = metadata.parsedJson;
  } else if (carrier === "charx") {
    const archive = await readCharxCard(Buffer.from(buffer), {
      maxCardBytes: IMPORT_LIMITS.MAX_CHARX_CARD_SIZE_MB * 1024 * 1024,
      maxAssets: IMPORT_LIMITS.MAX_CHARX_ASSETS,
      maxTotalAssetBytes: IMPORT_LIMITS.MAX_CHARX_ASSET_TOTAL_MB * 1024 * 1024,
    });
    if (!archive.ok) return { ok: false, reason: "unsupported" };
    parsed = archive.card;
  } else {
    try {
      parsed = JSON.parse(new TextDecoder().decode(buffer).replace(/^\uFEFF/u, ""));
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
  }
  const root = asSillyTavernObject(parsed);
  const book = extractCharacterBook(parsed);
  if (carrier !== "json" || getSillyTavernString(root, "spec")?.toLowerCase().startsWith("chara_card")) {
    if (!book) return { ok: false, reason: "no_book" };
  }
  const conversion = convertLorebookUpload(parsed);
  return conversion
    ? { ok: true, conversion, name: getSillyTavernString(book ?? root, "name") ?? undefined }
    : { ok: false, reason: "unsupported" };
}
