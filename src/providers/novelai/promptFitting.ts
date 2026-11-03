import type { TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import {
  getNovelAIProfile,
  getNovelAISamplerConfig,
  enableNovelAIPresetSamplers,
  type NovelAIModelProfile,
} from "@/providers/novelai/modelProfiles";
import { configRepository } from "@/utils/db/repositories";
import { NovelAIPreparationError } from "@/providers/novelai/preparationError";
import {
  assembleGlmChatPrompt,
  assembleNovelAIPrompt,
  assembleXialongPrompt,
  buildAttgBlock,
} from "@/providers/novelai/promptRenderers";
import { getParametersForModel, type NovelAIParameters } from "@/providers/novelai/novelaiService";
import { getCachedNovelAISubscription, refreshNovelAISubscription } from "@/utils/cache/novelaiSubscriptionCache";
import { createNovelAITokenizerEncoder } from "@/utils/provider/localTokenizerRegistry";
import { isParamDisabled } from "@/utils/provider/samplingControl";
import { normalizeNovelAIContextText } from "@/providers/novelai/messageNormalization";
import {
  resolveNovelAISpeakers,
  NOVELAI_SEPARATOR_STOPS,
  type NovelAISpeakers,
} from "@/providers/novelai/speakerBoundaries";
import { buildProviderStopStrings } from "@/providers/utils/stopStrings";

const admittedTags = new Set([
  ContextItemTag.SYSTEM_PERSONALITY,
  ContextItemTag.DIALOGUE_SAMPLE,
  ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
  ContextItemTag.KNOWLEDGE_USER_MEMORIES,
  ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
  ContextItemTag.DIALOGUE_HISTORY,
]);
const memoryTags = new Set([
  ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
  ContextItemTag.KNOWLEDGE_USER_MEMORIES,
  ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
]);
// Keep one sample exchange and two recent history exchanges until conversational quality checks justify a different floor.
const MINIMUM_SAMPLE_EXCHANGES = 1;
const MINIMUM_HISTORY_EXCHANGES = 2;
const MEMORY_WINDOW_FRACTION = 0.2;
// Erato expands each name into multiple token sequences, so match SillyTavern's 1,024-sequence cap to bound the request.
const MAX_NATIVE_STOP_SEQUENCES = 1024;

export interface NovelAIFitReport {
  included: string[];
  excluded: string[];
  trimmed: string[];
  inputTokens: number;
  window: number;
  outputCap: number;
  framingReserve: number;
  sentenceReserve: number;
}

export interface PreparedNovelAIRequest {
  prompt: string;
  parameters: NovelAIParameters;
  report: NovelAIFitReport;
  contextItems: StructuredContextItem[];
  speakers: NovelAISpeakers;
  stopStrings: string[];
}

interface FitInput {
  contextItems: StructuredContextItem[];
  tomoriState: TomoriState;
  profile: NovelAIModelProfile;
  window: number;
  maxOutputTokens?: number;
  outputPrefill?: string;
  continuationPrefill?: string;
  forceReason?: boolean;
  triggerMessageId?: string;
}

function itemText(item: StructuredContextItem): string {
  return item.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function exchangeGroups(items: StructuredContextItem[], tag: ContextItemTag): StructuredContextItem[][] {
  const groups: StructuredContextItem[][] = [];
  for (const item of items.filter((item) => item.metadataTag === tag)) {
    if (item.role === "user" || groups.length === 0) groups.push([item]);
    else groups.at(-1)?.push(item);
  }
  return groups;
}

export function fitNovelAIPrompt(args: FitInput): PreparedNovelAIRequest {
  const { profile, tomoriState } = args;
  const encode = createNovelAITokenizerEncoder(profile.tokenizer);
  const speakers = resolveNovelAISpeakers(args.contextItems, tomoriState);
  const stopStrings =
    buildProviderStopStrings({
      providerName: "novelai",
      model: profile.codename,
      configuredStops: tomoriState.config.llm_stop_strings,
      existingStops: [
        ...NOVELAI_SEPARATOR_STOPS,
        ...speakers.foreignNames.flatMap((name) =>
          [name, name.replace(/^(?=\p{Script=Latin})\p{Ll}/u, (letter) => letter.toUpperCase())].flatMap((label) => [
            `\n${label}:`,
            `\n${label}：`,
          ]),
        ),
      ],
    }) ?? [];
  const personaNames = [
    ...new Set([
      tomoriState.persona_nickname,
      ...args.contextItems.flatMap((item) => [
        ...(item.sender?.type === "persona" ? [item.sender.name] : []),
        ...(item.participantTargetIndex?.targets
          .filter((target) => target.key.kind === "persona")
          .map((target) => target.displayLabel) ?? []),
      ]),
    ]),
  ];
  const excluded: string[] = [];
  const trimmed: string[] = [];
  const identities = new Map<StructuredContextItem, string>();
  const memoryTimes = new Map<StructuredContextItem, number>();
  let selected: StructuredContextItem[] = [];
  args.contextItems.forEach((original, index) => {
    const id = `${index}:${original.metadataTag ?? "untagged"}:${original.messageId ?? ""}`;
    const candidates =
      original.metadataTag === ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION
        ? (original.personalMemoryItems ?? [])
        : [original];
    if (original.metadataTag === ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION) excluded.push(id);
    for (const [candidateIndex, item] of candidates.entries()) {
      if (
        !item.metadataTag ||
        !admittedTags.has(item.metadataTag) ||
        (item.metadataTag === ContextItemTag.DIALOGUE_HISTORY && item.completionText === undefined)
      ) {
        if (item === original) excluded.push(id);
        continue;
      }
      const entries = item.memoryEntries;
      const units = entries?.length
        ? entries.map((entry) => ({
            ...item,
            memoryEntries: undefined,
            parts: [{ type: "text" as const, text: entry.text }],
          }))
        : [
            {
              ...item,
              parts:
                item.completionText !== undefined
                  ? [
                      {
                        type: "text" as const,
                        text: item.completionText ?? "",
                      },
                    ]
                  : item.parts.filter((part) => part.type === "text"),
            },
          ];
      units.forEach((unit, entryIndex) => {
        const isOutputPrefill =
          unit.metadataTag === ContextItemTag.DIALOGUE_HISTORY && unit.completionText === args.outputPrefill;
        if (profile.normalizeMessages && !isOutputPrefill && unit.metadataTag !== ContextItemTag.SYSTEM_PERSONALITY) {
          unit.parts = [{ type: "text", text: normalizeNovelAIContextText(unit, personaNames) }];
        }
        memoryTimes.set(unit, entries?.[entryIndex]?.createdAt ?? 0);
        const unitId = `${id}:${candidateIndex}:${entries?.[entryIndex]?.id ?? entryIndex}`;
        identities.set(unit, unitId);
        if (itemText(unit).trim()) selected.push(unit);
        else excluded.push(unitId);
      });
    }
  });
  const remove = (units: StructuredContextItem[]) => {
    for (const item of units) trimmed.push(identities.get(item) ?? "");
    const removed = new Set(units);
    selected = selected.filter((item) => !removed.has(item));
  };
  const parameters = buildNovelAIParameters(args.tomoriState, args.profile.codename);
  if (profile.endpoint === "/ai/generate-stream") {
    const nativeStops =
      profile.codename === "llama-3-erato-v1"
        ? stopStrings.flatMap((stop) =>
            stop.startsWith("\n")
              ? ["", ".", "!", "?", "*", '"', "_", "...", '."', '?"', '!"', ".*", ")"].map((prefix) => prefix + stop)
              : [stop],
          )
        : stopStrings;
    parameters.stop_sequences = [
      ...(parameters.stop_sequences ?? []),
      ...nativeStops.map((stop) => encode(stop)),
    ].slice(0, MAX_NATIVE_STOP_SEQUENCES);
  }
  const desiredOutput = Math.max(
    1,
    Math.min(
      profile.outputCeiling ?? args.window,
      args.maxOutputTokens ?? tomoriState.config.llm_max_output_tokens ?? profile.defaultOutputTokens,
    ),
  );
  const sentenceReserve = parameters.generate_until_sentence ? profile.sentenceCompletionReserve : 0;
  const overhead = profile.nativeFramingTokens + sentenceReserve;
  const render = (): string => {
    const botName = tomoriState.persona_nickname;
    let prompt: string;
    if (profile.renderer === "story") {
      const base = assembleNovelAIPrompt(selected, botName, {
        attgBlock: buildAttgBlock(tomoriState, profile.codename),
      });
      prompt =
        args.outputPrefill && base.trimEnd().endsWith(args.outputPrefill.trim()) ? base : `${base}\n${botName}: `;
    } else if (profile.renderer === "xialong") {
      prompt = assembleXialongPrompt(selected, profile.systemPrompt, {
        attgBlock: buildAttgBlock(tomoriState, profile.codename),
        outputPrefill: args.outputPrefill,
        thinkingLevel: tomoriState.config.thinking_level,
        forceReason: args.forceReason,
      });
    } else {
      prompt = assembleGlmChatPrompt(selected, botName, profile.characterPrefix, {
        thinkingLevel: tomoriState.config.thinking_level,
        forceReason: args.forceReason,
        thinkingByDefault: profile.thinkingByDefault,
      });
      if (args.outputPrefill && selected.at(-1)?.completionText === args.outputPrefill) {
        const withoutPrefill = selected.slice(0, -1);
        prompt = assembleGlmChatPrompt(withoutPrefill, botName, profile.characterPrefix, {
          thinkingLevel: tomoriState.config.thinking_level,
          forceReason: args.forceReason,
          thinkingByDefault: profile.thinkingByDefault,
        });
        prompt = profile.characterPrefix
          ? `${prompt.slice(0, -`${botName}:`.length)}${args.outputPrefill}`
          : `${prompt}\n${args.outputPrefill}`;
      }
    }
    return args.continuationPrefill ? `${prompt}${args.continuationPrefill}` : prompt;
  };
  let prompt = render();
  let inputTokens = encode(prompt).length;
  const recount = () => {
    prompt = render();
    inputTokens = encode(prompt).length;
  };
  const samples = exchangeGroups(selected, ContextItemTag.DIALOGUE_SAMPLE);
  const extraSamples = samples.slice(MINIMUM_SAMPLE_EXCHANGES).reverse();
  const memories = selected
    .filter((item) => item.metadataTag && memoryTags.has(item.metadataTag))
    .sort((left, right) => (memoryTimes.get(left) ?? 0) - (memoryTimes.get(right) ?? 0));
  // Eligibility supplies no relevance score, so older memories leave first and source order breaks ties.
  while (memories.length && encode(memories.map(itemText).join("\n")).length > args.window * MEMORY_WINDOW_FRACTION) {
    const item = memories.shift();
    if (item) remove([item]);
  }
  recount();
  const history = exchangeGroups(
    selected.filter(
      (item) => !(args.outputPrefill && item === selected.at(-1) && item.completionText === args.outputPrefill),
    ),
    ContextItemTag.DIALOGUE_HISTORY,
  );
  const oldHistory = history
    .slice(0, -MINIMUM_HISTORY_EXCHANGES)
    .filter(
      (group) =>
        !group.some((item) =>
          Boolean(
            args.triggerMessageId &&
              (item.messageId === args.triggerMessageId || item.combinedMessageIds?.includes(args.triggerMessageId)),
          ),
        ),
    );
  for (const group of [...extraSamples, ...memories.map((item) => [item]), ...oldHistory]) {
    if (inputTokens + desiredOutput + overhead <= args.window) break;
    remove(group);
    recount();
  }
  const outputCap = Math.min(desiredOutput, args.window - inputTokens - overhead);
  if (outputCap < 1) throw new NovelAIPreparationError("context_overflow");
  parameters.max_length = outputCap;
  if (parameters.min_length !== undefined) parameters.min_length = Math.min(parameters.min_length, outputCap);
  return {
    prompt,
    parameters,
    contextItems: selected,
    speakers,
    stopStrings,
    report: {
      included: selected.map((item) => identities.get(item) ?? ""),
      excluded,
      trimmed,
      inputTokens,
      window: args.window,
      outputCap,
      framingReserve: profile.nativeFramingTokens,
      sentenceReserve,
    },
  };
}

function buildNovelAIParameters(state: TomoriState, model: string): NovelAIParameters {
  const profile = getNovelAIProfile(model);
  const candidate = state.nai_preset;
  const matchingPreset =
    candidate?.model_target === profile.samplingPresetTarget &&
    (!state.config.nai_preset_name || state.config.nai_preset_name === candidate.preset_name)
      ? candidate
      : undefined;
  const modelChanged = state.config.llm_id !== state.llm.llm_id;
  const incompatible =
    Boolean(candidate && !matchingPreset) ||
    (profile.samplingPresetTarget === null && Boolean(state.config.nai_preset_name));
  const config =
    modelChanged || incompatible
      ? {
          ...state.config,
          ...getNovelAISamplerConfig(model, matchingPreset),
          llm_disabled_params: enableNovelAIPresetSamplers(state.config.llm_disabled_params ?? []),
        }
      : state.config;
  const disabled = config.llm_disabled_params ?? [];
  const preset = Object.fromEntries(
    Object.entries(matchingPreset?.parameters ?? {}).filter(
      ([key]) => !["temperature", "top_k", "top_p", "min_p"].includes(key),
    ),
  );
  const params = getParametersForModel(
    model,
    isParamDisabled(disabled, "temperature") ? undefined : config.llm_temperature,
    isParamDisabled(disabled, "topK") ? undefined : config.llm_top_k,
    isParamDisabled(disabled, "topP") ? undefined : config.llm_top_p,
    isParamDisabled(disabled, "minP") ? undefined : config.llm_min_p,
    preset,
  );
  for (const [key, param] of [
    ["temperature", "temperature"],
    ["topK", "top_k"],
    ["topP", "top_p"],
    ["minP", "min_p"],
  ] as const) {
    if (isParamDisabled(disabled, key)) delete params[param];
  }
  return params;
}

export async function prepareNovelAIRequest(
  args: Omit<FitInput, "profile" | "window"> & { model: string; apiKey: string },
): Promise<PreparedNovelAIRequest> {
  const profile = getNovelAIProfile(args.model);
  const subscription = getCachedNovelAISubscription(args.apiKey) ?? (await refreshNovelAISubscription(args.apiKey));
  if (!subscription) throw new NovelAIPreparationError("subscription_unavailable");
  if (!subscription.active) throw new NovelAIPreparationError("subscription_inactive");
  const window = profile.contextByTier[subscription.tier];
  if (!window) throw new NovelAIPreparationError(args.model === "xialong-v1" ? "xialong_opus" : "model_tier");
  let tomoriState = args.tomoriState;
  const presetName = tomoriState.config.nai_preset_name;
  if (
    profile.samplingPresetTarget &&
    presetName &&
    (tomoriState.nai_preset?.preset_name !== presetName ||
      tomoriState.nai_preset?.model_target !== profile.samplingPresetTarget)
  ) {
    const preset = await configRepository.resolveNaiPreset(args.model, presetName);
    tomoriState = {
      ...tomoriState,
      nai_preset: preset,
      config:
        preset?.preset_name !== presetName
          ? {
              ...tomoriState.config,
              ...getNovelAISamplerConfig(args.model, preset),
              llm_disabled_params: enableNovelAIPresetSamplers(tomoriState.config.llm_disabled_params ?? []),
            }
          : tomoriState.config,
    };
  }
  return fitNovelAIPrompt({ ...args, tomoriState, profile, window });
}
