import {
  emptyConversionReport,
  mergeConversionReports,
  type LorebookConversion,
  convertCharacterBook,
} from "./characterBook";
import {
  asSillyTavernObject,
  clampSillyTavernInt,
  getSillyTavernString,
  getSillyTavernStringArray,
} from "./sillyTavernFields";

const UNSUPPORTED_FLAGS = [
  "excludeRecursion",
  "preventRecursion",
  "ignoreBudget",
  "matchPersonaDescription",
  "matchCharacterDescription",
  "matchCharacterPersonality",
  "matchCharacterDepthPrompt",
  "matchScenario",
  "matchCreatorNotes",
] as const;

const UNSUPPORTED_TIMING = ["sticky", "cooldown", "delay"] as const;

/** True when the entry carries activation settings this destination cannot store. */
function hasUnsupportedWorldInfoFields(entry: Record<string, unknown>): boolean {
  if ((getSillyTavernString(entry, "group") ?? "") !== "") return true;
  if ((getSillyTavernString(entry, "outletName") ?? "") !== "") return true;
  if ((getSillyTavernString(entry, "automationId") ?? "") !== "") return true;
  if (entry.vectorized === true) return true;
  if (UNSUPPORTED_FLAGS.some((flag) => entry[flag] === true)) return true;
  if (UNSUPPORTED_TIMING.some((field) => typeof entry[field] === "number" && (entry[field] as number) > 0)) return true;
  if (typeof entry.delayUntilRecursion === "number" && entry.delayUntilRecursion > 0) return true;
  return Array.isArray(entry.triggers) && entry.triggers.length > 0;
}

/** SillyTavern positions 2 to 7 have no destination here, so those entries collapse to before the persona and are counted. */
export function convertWorldInfoFile(root: unknown): LorebookConversion | null {
  const file = asSillyTavernObject(root);
  const keyedEntries = asSillyTavernObject(file?.entries);
  if (!file || !keyedEntries) return null;

  const report = emptyConversionReport();
  const entries: Record<string, unknown>[] = [];
  for (const raw of Object.values(keyedEntries)) {
    const entry = asSillyTavernObject(raw);
    if (!entry) {
      report.skippedEntries++;
      continue;
    }
    const position = clampSillyTavernInt(entry.position, 0, 7, 0);
    if (position > 1) report.collapsedPlacement++;
    if (hasUnsupportedWorldInfoFields(entry)) report.ignoredEntries++;
    entries.push({
      keys: getSillyTavernStringArray(entry, "key"),
      secondary_keys: getSillyTavernStringArray(entry, "keysecondary"),
      comment: getSillyTavernString(entry, "comment"),
      content: getSillyTavernString(entry, "content"),
      constant: entry.constant === true,
      selective: entry.selective !== false,
      enabled: entry.disable !== true,
      insertion_order: entry.order,
      position: position === 1 ? "after_char" : "before_char",
      extensions: {
        selectiveLogic: entry.selectiveLogic,
        probability: entry.probability,
        useProbability: entry.useProbability,
        scan_depth: typeof entry.scanDepth === "number" ? entry.scanDepth : undefined,
      },
    });
  }

  const converted = convertCharacterBook({ entries });
  return { entries: converted.entries, report: mergeConversionReports(report, converted.report) };
}
