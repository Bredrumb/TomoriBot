import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";

interface SpecializedStopStringRule {
  providerName?: string;
  exactModels?: readonly string[];
  modelPattern?: RegExp;
  stopStrings: readonly string[];
}

type StopStringInput = string | null | undefined | readonly (string | null | undefined)[];

const UNIVERSAL_STOP_STRINGS: readonly string[] = ["<｜begin▁of▁sentence｜>"];

const SPECIALIZED_STOP_STRING_RULES: readonly SpecializedStopStringRule[] = [];

// The newline prefix is intentional so an initial speaker label at the very start of a response is not blocked.
function buildPersonaSpeakerStopString(personaName?: string | null): string | null {
  if (!personaName) return null;

  const normalizedName = personaName
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalizedName) return null;

  return `\n${normalizedName}:`;
}

function appendStopString(target: string[], stop: string | null | undefined): void {
  if (typeof stop !== "string" || stop.length === 0) {
    return;
  }

  if (!target.includes(stop)) {
    target.push(stop);
  }
}

function matchesSpecializedStopRule(
  rule: SpecializedStopStringRule,
  providerName?: string | null,
  model?: string | null,
): boolean {
  const normalizedProvider = providerName?.trim().toLowerCase() ?? "";
  const normalizedModel = model?.trim().toLowerCase() ?? "";

  if (rule.providerName && rule.providerName !== normalizedProvider) {
    return false;
  }

  if (rule.exactModels && !rule.exactModels.includes(normalizedModel)) {
    return false;
  }

  if (rule.modelPattern && !rule.modelPattern.test(model ?? "")) {
    return false;
  }

  return true;
}

function getUniversalStopStrings(): string[] | undefined {
  const universalStops: string[] = [];

  for (const stop of UNIVERSAL_STOP_STRINGS) {
    appendStopString(universalStops, stop);
  }

  return universalStops.length > 0 ? universalStops : undefined;
}

function getSpecializedStopStrings(providerName?: string | null, model?: string | null): string[] | undefined {
  const matchedStops: string[] =
    providerName?.toLowerCase() === "novelai" && model ? [...getNovelAIProfile(model).stopStrings] : [];

  for (const rule of SPECIALIZED_STOP_STRING_RULES) {
    if (!matchesSpecializedStopRule(rule, providerName, model)) {
      continue;
    }

    for (const stop of rule.stopStrings) {
      appendStopString(matchedStops, stop);
    }
  }

  return matchedStops.length > 0 ? matchedStops : undefined;
}

export function mergeStopStrings(
  existingStops: readonly string[] | undefined,
  ...additionalStopInputs: StopStringInput[]
): string[] | undefined {
  const mergedStops: string[] = [];

  for (const stop of existingStops ?? []) {
    appendStopString(mergedStops, stop);
  }

  for (const input of additionalStopInputs) {
    if (typeof input === "string" || input == null) {
      appendStopString(mergedStops, input);
      continue;
    }

    for (const stop of input) {
      appendStopString(mergedStops, stop);
    }
  }

  return mergedStops.length > 0 ? mergedStops : undefined;
}

export interface ProviderStopStringArgs {
  existingStops?: readonly string[];
  providerName?: string | null;
  model?: string | null;
  personaName?: string | null;
  configuredStops?: readonly string[] | null;
  includePersonaSpeakerStop?: boolean;
}

export function buildProviderStopStrings(args: ProviderStopStringArgs): string[] | undefined {
  return mergeStopStrings(
    args.existingStops,
    getUniversalStopStrings(),
    getSpecializedStopStrings(args.providerName, args.model),
    args.configuredStops,
    args.includePersonaSpeakerStop ? buildPersonaSpeakerStopString(args.personaName) : null,
  );
}
