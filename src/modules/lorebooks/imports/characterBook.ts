import {
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_DEFAULT_INSERTION_ORDER,
  LOREBOOK_DEFAULT_SCAN_DEPTH,
  LOREBOOK_SCAN_DEPTH_MAX,
  LOREBOOK_TITLE_MAX,
  isLorebookRegexKey,
  normalizeLorebookKeys,
  type LorebookEntryInput,
} from "@/modules/lorebooks/db/types";
import { sanitizeSillyTavernText } from "@/utils/text/sillyTavernText";
import {
  asSillyTavernObject,
  clampSillyTavernInt,
  getSillyTavernString,
  getSillyTavernStringArray,
} from "./sillyTavernFields";

export interface LorebookConversionReport {
  skippedEntries: number;
  unsupportedKeys: number;
  ignoredEntries: number;
  collapsedPlacement: number;
}

export interface LorebookConversion {
  entries: LorebookEntryInput[];
  report: LorebookConversionReport;
}

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const DEFAULT_TITLE = "Character Book Entry";

export function emptyConversionReport(): LorebookConversionReport {
  return { skippedEntries: 0, unsupportedKeys: 0, ignoredEntries: 0, collapsedPlacement: 0 };
}

export function mergeConversionReports(
  first: LorebookConversionReport,
  second: LorebookConversionReport,
): LorebookConversionReport {
  return {
    skippedEntries: first.skippedEntries + second.skippedEntries,
    unsupportedKeys: first.unsupportedKeys + second.unsupportedKeys,
    ignoredEntries: first.ignoredEntries + second.ignoredEntries,
    collapsedPlacement: first.collapsedPlacement + second.collapsedPlacement,
  };
}

/** Splits content at the edit limit without bisecting a surrogate pair. */
function splitLorebookContent(content: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < content.length; ) {
    let end = Math.min(offset + LOREBOOK_CONTENT_MAX, content.length);
    if (end < content.length && /[\uD800-\uDBFF]/u.test(content[end - 1]) && /[\uDC00-\uDFFF]/u.test(content[end])) {
      end--;
    }
    const chunk = content.slice(offset, end);
    if (chunk.trim()) chunks.push(chunk);
    offset = end;
  }
  return chunks;
}

function truncateLorebookTitle(title: string, suffix = ""): string {
  return `${title.slice(0, LOREBOOK_TITLE_MAX - suffix.length).trim()}${suffix}`;
}

/** Maps a Character Book (a card's `character_book`) into lorebook entries. */
export function convertCharacterBook(characterBook: unknown): LorebookConversion {
  const book = asSillyTavernObject(characterBook);
  const report = emptyConversionReport();
  const entries: LorebookEntryInput[] = [];
  if (!Array.isArray(book?.entries)) return { entries, report };

  for (const raw of book.entries) {
    const entry = asSillyTavernObject(raw);
    const content = sanitizeSillyTavernText(getSillyTavernString(entry, "content") ?? "");
    if (!entry || !content) {
      report.skippedEntries++;
      continue;
    }
    const extensions = asSillyTavernObject(entry.extensions);
    const readKeys = (field: string): string[] => {
      const rawKeys = getSillyTavernStringArray(entry, field);
      const keys = normalizeLorebookKeys(
        rawKeys.map((key) => {
          if (entry.use_regex === true && !isLorebookRegexKey(key)) return `/${key}/`;
          return key;
        }),
      );
      report.unsupportedKeys += rawKeys.length - keys.length + keys.filter(isLorebookRegexKey).length;
      return keys;
    };
    const keys = readKeys("keys");
    const constant = entry.constant === true;
    if (!constant && keys.length === 0) {
      report.skippedEntries++;
      continue;
    }
    const secondaryKeys = entry.selective === true ? readKeys("secondary_keys") : [];
    const title =
      getSillyTavernString(entry, "name") ?? getSillyTavernString(entry, "comment") ?? keys.slice(0, 3).join(", ");
    const baseTitle = title || DEFAULT_TITLE;
    const placement = entry.position === "after_char" || extensions?.position === 1 ? 1 : 0;
    if (typeof extensions?.position === "number" && extensions.position > 1) report.collapsedPlacement++;

    for (const [part, chunk] of splitLorebookContent(content).entries()) {
      const suffix = part === 0 ? "" : ` (${part + 1})`;
      entries.push({
        title: truncateLorebookTitle(baseTitle, suffix),
        content: chunk,
        keys,
        secondary_keys: secondaryKeys,
        selective_logic: clampSillyTavernInt(extensions?.selectiveLogic, 0, 3, 0) as 0 | 1 | 2 | 3,
        scan_depth: clampSillyTavernInt(
          extensions?.scan_depth ?? book.scan_depth,
          1,
          LOREBOOK_SCAN_DEPTH_MAX,
          LOREBOOK_DEFAULT_SCAN_DEPTH,
        ),
        trigger_chance:
          extensions?.useProbability === false ? 100 : clampSillyTavernInt(extensions?.probability, 1, 100, 100),
        insertion_order: clampSillyTavernInt(
          entry.insertion_order,
          INT32_MIN,
          INT32_MAX,
          LOREBOOK_DEFAULT_INSERTION_ORDER,
        ),
        placement: placement as 0 | 1,
        constant,
        enabled: entry.enabled !== false,
        channel_disc_ids: [],
      });
    }
  }
  return { entries, report };
}
