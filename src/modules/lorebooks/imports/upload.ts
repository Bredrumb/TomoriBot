import { convertCharacterBook, type LorebookConversion } from "./characterBook";
import { asSillyTavernObject } from "./sillyTavernFields";
import { convertWorldInfoFile } from "./worldInfo";

export const LOREBOOK_IMPORT_MAX_FILE_MB = 2;

/** A keyed `entries` object is a world info file, an array is a Character Book, and anything else is null. */
export function convertLorebookUpload(input: unknown): LorebookConversion | null {
  const root = asSillyTavernObject(input);
  if (!root) return null;
  if (Array.isArray(root.entries)) return convertCharacterBook(root);
  return convertWorldInfoFile(root);
}

export type LorebookUploadParseResult =
  | { ok: true; conversion: LorebookConversion }
  | { ok: false; reason: "invalid_json" | "unsupported" };

/** Strips a byte-order mark before decoding, since editors and export tools commonly write one. */
export function parseLorebookUpload(buffer: Uint8Array): LorebookUploadParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buffer).replace(/^\uFEFF/u, ""));
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  const conversion = convertLorebookUpload(parsed);
  return conversion ? { ok: true, conversion } : { ok: false, reason: "unsupported" };
}
