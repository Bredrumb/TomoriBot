/**
 * Provider stop-string helpers.
 *
 * These utilities keep turn-boundary stop behavior consistent across providers
 * while preserving first-turn behavior (a response can still begin with "Name:").
 * They also centralize provider/model-specific stop strings for models that
 * hallucinate sentinel/control tokens.
 */

import { THINK_CLOSE_TAG } from "@/providers/utils/reasoningTags";

interface SpecializedStopStringRule {
  providerName?: string;
  exactModels?: readonly string[];
  modelPattern?: RegExp;
  stopStrings: readonly string[];
}

type StopStringInput = string | null | undefined | readonly (string | null | undefined)[];

/**
 * Universal stop strings applied to every provider path that supports stop
 * parameters.
 */
const UNIVERSAL_STOP_STRINGS: readonly string[] = ["<｜begin▁of▁sentence｜>"];

/**
 * Central registry for provider/model-specific stop strings.
 *
 * Add new specialized stop strings here when a model starts emitting control
 * tokens or sentinel markers that should terminate generation immediately.
 */
const SPECIALIZED_STOP_STRING_RULES: readonly SpecializedStopStringRule[] = [
  {
    // NovelAI's OpenAI-compatible GLM endpoint may emit role tags or stray
    // closing think tags in completions mode. Stop strings are sent to the API
    // and matched literally, so a namespaced variant (e.g. `</mm:think>`) must
    // be added here explicitly per model, so see reasoningTags.ts for the shape.
    providerName: "novelai",
    exactModels: ["glm-4-6"],
    stopStrings: ["<|user|>", "<|observation|>", "<|system|>", THINK_CLOSE_TAG],
  },
];

/**
 * Build a newline-prefixed speaker stop string for the current persona.
 * Example: "\nTomori:"
 *
 * Newline prefix is intentional so an initial "Tomori:" at the very beginning
 * of a response is not blocked.
 */
export function buildPersonaSpeakerStopString(personaName?: string | null): string | null {
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

export function getUniversalStopStrings(): string[] | undefined {
  const universalStops: string[] = [];

  for (const stop of UNIVERSAL_STOP_STRINGS) {
    appendStopString(universalStops, stop);
  }

  return universalStops.length > 0 ? universalStops : undefined;
}

export function getSpecializedStopStrings(providerName?: string | null, model?: string | null): string[] | undefined {
  const matchedStops: string[] = [];

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

/**
 * Merge additional stop strings into an existing stop list, preserving order
 * and avoiding duplicates.
 */
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

/**
 * Build the final provider stop-string list from:
 * 1. Any adapter-specific existing stops
 * 2. Universal rules from this module
 * 3. Specialized provider/model rules from this module
 * 4. Server-configured exact stop strings
 * 5. The active persona's newline-prefixed speaker stop, when enabled
 */
export function buildProviderStopStrings(args: ProviderStopStringArgs): string[] | undefined {
  return mergeStopStrings(
    args.existingStops,
    getUniversalStopStrings(),
    getSpecializedStopStrings(args.providerName, args.model),
    args.configuredStops,
    args.includePersonaSpeakerStop ? buildPersonaSpeakerStopString(args.personaName) : null,
  );
}
