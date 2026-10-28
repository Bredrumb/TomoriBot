import { convertCharacterBook, type LorebookConversion } from "./characterBook";
import { asSillyTavernObject } from "./sillyTavernFields";
import { convertWorldInfoFile } from "./worldInfo";

/** A keyed `entries` object is a world info file, an array is a Character Book, and anything else is null. */
export function convertLorebookUpload(input: unknown): LorebookConversion | null {
  const root = asSillyTavernObject(input);
  if (!root) return null;
  if (Array.isArray(root.entries)) return convertCharacterBook(root);
  return convertWorldInfoFile(root);
}
