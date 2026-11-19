import type { FallbackEntry, FallbackModelRef, NaiPresetRow, TomoriState } from "@/types/db/schema";
import { configRepository, llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import {
  CONFIG_FALLBACK_PAGE_SIZE,
  CONFIG_FALLBACK_SLOT_COUNT,
  CONFIG_MODEL_CAPABILITY_ORDER,
  computeNaiPresetFingerprint,
  type ConfigModelCapability,
} from "@/utils/discord/configPanelCatalog";
import { formatModelOverrideModelSummary } from "@/utils/discord/modelOverrideCatalog";
import { loadModelOverrideEntries } from "@/utils/discord/interactions/modelOverrideRoutes";
import {
  CONFIG_FALLBACK_ENDPOINT_PREFIX,
  loadConfigModelChoices,
  loadConfigModelProviders,
  resolveNaiPresetTarget,
} from "@/utils/discord/interactions/configModelOperations";
import type { ConfigFallbackOption } from "@/utils/discord/ui/configModelModals";
import type {
  ConfigFallbacksView,
  ConfigImageGenerationView,
  ConfigParametersView,
  ConfigSwitchModelsProviderPage,
  ConfigSwitchModelsView,
} from "@/utils/discord/ui/configModelsPanel";
import { buildProviderPageEntries } from "@/utils/discord/ui/modelRoutingControls";
import { resolveProviderEntryStart } from "@/utils/discord/ui/providerSelectWindow";
import { resolveNaiImageParams } from "@/utils/image/naiImageParams";
import { buildCustomProviderName, isCustomProvider, parseCustomProvider } from "@/utils/provider/customProviderUtils";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { freeModelPriceLabel, resolveRowPricing } from "@/utils/provider/modelPricing";
import { modelOptionDetail } from "@/utils/discord/ui/modelSelectOption";
import {
  describeProviderOptionModelChoices,
  findProviderOption,
  getProviderOptionFallbackRefOwner,
  findProviderOptionByActiveProvider,
  providerOptionCapabilityForModelView,
  type ProviderOptionModelViewCapability,
} from "@/utils/provider/providerOptionRegistry";
import { loadSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { localizer, resolveDescription } from "@/utils/text/localizer";

async function resolveSlotAssignment(
  state: TomoriState,
  capability: ConfigModelCapability,
): Promise<{ modelName: string | null; provider: string | null }> {
  switch (capability) {
    case "text":
      return { modelName: state.llm?.llm_codename ?? null, provider: state.llm?.llm_provider ?? null };
    case "vision":
      return {
        modelName: state.vision_llm?.llm_codename ?? null,
        provider: state.vision_llm?.llm_provider ?? null,
      };
    case "embedding": {
      const id = state.config.embedding_model_id;
      if (!id) return { modelName: null, provider: null };
      const model = await llmModelRepo.loadEmbeddingModelById(id);
      return { modelName: model?.codename ?? null, provider: model?.provider ?? null };
    }
    case "decision": {
      const id = state.config.decision_model_id;
      if (!id) return { modelName: null, provider: null };
      const model = await llmModelRepo.loadDecisionModelById(id);
      return { modelName: model?.codename ?? null, provider: model?.provider ?? null };
    }
    case "image":
    case "nai-image": {
      const id = capability === "image" ? state.config.diffusion_model_id : state.config.nai_diffusion_model_id;
      if (!id) return { modelName: null, provider: null };
      const model = await llmModelRepo.loadDiffusionModelById(id);
      return { modelName: model?.codename ?? null, provider: model?.provider ?? null };
    }
    case "video": {
      const id = state.config.video_model_id;
      if (!id) return { modelName: null, provider: null };
      const model = await llmModelRepo.loadVideoGenerationModelById(id);
      return { modelName: model?.codename ?? null, provider: model?.provider ?? null };
    }
    case "tts-design":
    case "tts-clone": {
      const design = capability === "tts-design";
      const endpointId = design ? state.config.speech_design_endpoint_id : state.config.speech_clone_endpoint_id;
      if (endpointId) {
        const [endpoint] = await llmProviderRepo.loadCustomEndpointsByIds([endpointId]);
        return endpoint
          ? {
              modelName: endpoint.model_name ?? endpoint.label,
              provider: buildCustomProviderName(endpoint.connection_id),
            }
          : { modelName: null, provider: null };
      }
      const id = design ? state.config.speech_design_model_id : state.config.speech_clone_model_id;
      if (!id) return { modelName: null, provider: null };
      const model = await llmModelRepo.loadSpeechModelById(id);
      return { modelName: model?.codename ?? null, provider: model?.provider ?? null };
    }
    case "stt": {
      if (state.config.transcription_model_id) {
        const model = await llmModelRepo.loadTranscriptionModelById(state.config.transcription_model_id);
        return { modelName: model?.codename ?? null, provider: model?.provider ?? null };
      }
      const endpoint = (await llmProviderRepo.loadCustomEndpointsForServer(state.server_id)).find(
        (row) => row.capability === "transcription" && row.is_default,
      );
      return endpoint
        ? {
            modelName: endpoint.model_name ?? endpoint.label,
            provider: buildCustomProviderName(endpoint.connection_id),
          }
        : { modelName: null, provider: null };
    }
  }
}

// Separate workspaceDiscId is required because TomoriState holds only the internal server id while the persona cache
// keys by Discord snowflake.
export async function loadConfigSwitchModelsView(
  state: TomoriState,
  workspaceDiscId: string,
  providerPage: ConfigSwitchModelsProviderPage | undefined,
): Promise<ConfigSwitchModelsView> {
  const slots = await Promise.all(
    CONFIG_MODEL_CAPABILITY_ORDER.map(async (capability) => {
      const expanded = providerPage?.capability === capability ? (providerPage.provider ?? null) : null;
      const [assignment, providers, expandedOptionCount] = await Promise.all([
        resolveSlotAssignment(state, capability),
        loadConfigModelProviders(state.server_id, capability),
        // Only the expanded provider's catalog is measured: the renderer needs the count to decide
        // how many page entries it contributes, and loading every catalog to fill a field the
        // collapsed slots never read would put the whole model table behind every repaint.
        expanded ? loadConfigModelChoices(state.server_id, capability, expanded).then((rows) => rows.length) : 0,
      ]);
      const optionCapability = providerOptionCapabilityForModelView(capability as ProviderOptionModelViewCapability);
      const optionOwner =
        assignment.provider && optionCapability
          ? findProviderOptionByActiveProvider(
              assignment.provider,
              { kind: "server", ownerId: state.server_id, state },
              optionCapability,
            )
          : undefined;
      return {
        capability,
        currentModelName: assignment.modelName,
        currentProvider: optionOwner?.value ?? assignment.provider,
        eligibleProviders: providers,
        providerPageStart: providerPage?.capability === capability ? providerPage.start : 0,
        expandedProvider: expanded,
        expandedOptionCount,
      };
    }),
  );

  // The removal list and this summary read one loader, so a target named here is a target that
  // command can clear, and both surfaces print the same effective model for it.
  const { channelOverrides, personasWithOverride } = await loadModelOverrideEntries(state.server_id, workspaceDiscId);

  return {
    slots,
    channelOverrides: channelOverrides.map((entry) => ({
      target: `<#${entry.channelDiscId}>`,
      model: formatModelOverrideModelSummary(entry.llm),
    })),
    personaOverrides: personasWithOverride.map((entry) => ({
      target: `**${entry.persona_nickname}**`,
      model: formatModelOverrideModelSummary(entry.persona_llm),
    })),
    imageGenerationEnabled: state.config.imagegen_enabled,
    videoGenerationEnabled: state.config.videogen_enabled,
    speechCapabilityEnabled: state.config.voice_message_enabled ?? true,
  };
}

export async function loadConfigParametersView(
  state: TomoriState,
  requestedProvider: string | undefined,
  logitBiasPageStart: number,
  naiPresetPageStart = 0,
  workspaceKind: "guild" | "dm" = "guild",
): Promise<ConfigParametersView> {
  const providers = await loadSavedProvidersForCapability(state.server_id, "text");
  const selected =
    providers.find((row) => row.provider.toLowerCase() === requestedProvider?.toLowerCase()) ??
    providers.find((row) => row.provider.toLowerCase() === state.llm?.llm_provider?.toLowerCase()) ??
    providers[0] ??
    null;

  let naiPresetView: ConfigParametersView["naiPresetView"];
  if (workspaceKind === "guild" && selected?.provider.toLowerCase() === "novelai") {
    const target = resolveNaiPresetTarget(state);
    const presets: NaiPresetRow[] = target ? await configRepository.loadNaiPresets(target) : [];
    naiPresetView = {
      target,
      compatibility:
        target === null
          ? state.llm.llm_provider.toLowerCase() === "novelai"
            ? "unsupported"
            : "not-novelai"
          : "eligible",
      presets,
      activePresetName: state.nai_preset?.preset_name ?? null,
      fingerprint: target
        ? computeNaiPresetFingerprint(
            target,
            presets.map((preset) => preset.preset_name),
          )
        : null,
      pageStart: naiPresetPageStart,
    };
  }

  return {
    textProviders: providers.map((row) => row.provider),
    selectedProvider: selected?.provider ?? null,
    selectedConfig: selected,
    stopStrings: state.config.llm_stop_strings ?? [],
    speakerPatternEnabled: state.config.llm_stop_speaker_pattern_enabled ?? false,
    logitBiasEntries: state.config.llm_logit_biases ?? [],
    logitBiasPageStart,
    naiPresetView,
  };
}

function describeFallbackEntry(
  locale: string,
  entry: FallbackEntry | null,
  rawRef: FallbackModelRef | null,
): string | null {
  if (!entry) {
    if (!rawRef) return null;
    return `${localizer(locale, "general.unknown")} (#${rawRef.id})`;
  }
  if (entry.kind === "llm") {
    const provider = (rawRef && getProviderOptionFallbackRefOwner(rawRef)) ?? entry.model.llm_provider;
    return `${entry.model.llm_codename} (${getProviderDisplayName(provider, locale)})`;
  }
  return `${entry.endpoint.label}:${entry.endpoint.model_name ?? entry.endpoint.label} (${localizer(
    locale,
    "commands.model.fallback.custom_provider_label",
  )})`;
}

// Modal selects cap at 25 options and cannot page internally, so each provider option pre-encodes its modal
// option-page offset.
export function encodeConfigProviderPageValue(provider: string, start: number): string {
  return `${start}|${provider}`;
}

export function decodeConfigProviderPageValue(value: string): { provider: string; start: number } | null {
  const separator = value.indexOf("|");
  if (separator < 0) return null;
  const start = Number.parseInt(value.slice(0, separator), 10);
  const provider = value.slice(separator + 1);
  if (!Number.isInteger(start) || start < 0 || !provider) return null;
  return { provider, start };
}

// Pagination rides the select to fit Discord's 40-component cap, and expandedProvider must ride along so list
// collapse cannot invalidate the offset.
export function encodeConfigProviderRangeValue(start: number, expandedProvider: string | null): string {
  return `more|${start}|${expandedProvider ?? ""}`;
}

export function decodeConfigProviderRangeValue(
  value: string,
): { start: number; expandedProvider: string | null } | null {
  if (!value.startsWith("more|")) return null;
  const separator = value.indexOf("|", 5);
  if (separator < 0) return null;
  const start = Number.parseInt(value.slice(5, separator), 10);
  if (!Number.isInteger(start) || start < 0) return null;
  return { start, expandedProvider: value.slice(separator + 1) || null };
}

export async function loadConfigFallbacksView(
  state: TomoriState,
  locale: string,
  expandedProvider: string | null,
  entryStart = 0,
): Promise<ConfigFallbacksView> {
  const providers = await loadSavedProvidersForCapability(state.server_id, "text");
  const refs = state.config.fallback_model_refs ?? [];
  const chain = state.fallback_chain ?? [];

  const activeExpandedProvider = expandedProvider
    ? (providers.find((row) => row.provider.toLowerCase() === expandedProvider.toLowerCase())?.provider ?? null)
    : null;
  const expandedOptionCount = activeExpandedProvider
    ? (await loadConfigFallbackOptions(state, activeExpandedProvider)).length
    : 0;
  const { entries, expandedStartIndex, expandedPageCount } = buildProviderPageEntries({
    providers: providers.map((row) => row.provider),
    expandedProvider: activeExpandedProvider,
    expandedOptionCount,
    pageSize: CONFIG_FALLBACK_PAGE_SIZE,
    locale,
    pageLabelKey: "commands.config.panel.provider_page_label",
    encodeProviderValue: (provider) => encodeConfigProviderPageValue(provider, 0),
    encodePageValue: (provider, start) => encodeConfigProviderPageValue(provider, start),
  });

  return {
    slots: Array.from({ length: CONFIG_FALLBACK_SLOT_COUNT }, (_slot, index) => ({
      label: describeFallbackEntry(locale, chain[index] ?? null, refs[index] ?? null),
    })),
    providerEntries: entries,
    expandedProvider: expandedPageCount > 0 ? activeExpandedProvider : null,
    entryStart: resolveProviderEntryStart(entryStart, expandedStartIndex),
    randomizerEnabled: state.config.model_randomizer_enabled ?? false,
    hasFallbacks: refs.length > 0,
  };
}

// Custom providers resolve via connection-scoped endpoint rows rather than the model catalog so saved fallbacks stay
// bound to their exact endpoint.
export async function loadConfigFallbackOptions(
  state: TomoriState,
  provider: string,
  locale = "en-US",
): Promise<ConfigFallbackOption[]> {
  if (isCustomProvider(provider)) {
    const parsed = parseCustomProvider(provider);
    if (!parsed) return [];
    const endpoints = await llmProviderRepo.loadCustomEndpointsForServer(state.server_id);
    return endpoints
      .filter((endpoint) => endpoint.connection_id === parsed.connectionId && endpoint.capability === "text")
      .map((endpoint) => ({
        value: `${CONFIG_FALLBACK_ENDPOINT_PREFIX}${endpoint.custom_endpoint_id}`,
        label: `${endpoint.label}:${endpoint.model_name ?? endpoint.label}`,
        description: endpoint.model_name ?? endpoint.label,
      }));
  }

  const models =
    (await llmModelRepo.loadAvailableModelsForProvider(
      findProviderOption(provider)?.catalogProvider ?? provider,
      false,
      {
        kind: "server",
        ownerId: state.server_id,
      },
    )) ?? [];
  const choices = await describeProviderOptionModelChoices(provider, {
    scope: { kind: "server", ownerId: state.server_id },
    capability: "text",
    locale,
    // `other-model` is a migration placeholder rather than a routable model, so it never becomes a
    // fallback the chain would try to call.
    choices: models
      .filter(
        (model): model is typeof model & { llm_id: number } =>
          model.llm_codename !== "other-model" && typeof model.llm_id === "number",
      )
      .map((model) => {
        const pricing = resolveRowPricing(model);
        return {
          id: model.llm_id,
          name: model.llm_codename,
          description: resolveDescription(model.descriptions, locale),
          pricing,
          priceLabel: freeModelPriceLabel(locale, provider, model.is_free, pricing),
        };
      }),
  });
  return choices.map((choice) => ({
    value: choice.name,
    label: choice.name,
    description: modelOptionDetail(locale, provider, choice),
  }));
}

export function loadConfigImageGenerationView(state: TomoriState, locale: string): ConfigImageGenerationView {
  const effective = resolveNaiImageParams({
    nai_sampler: state.config.nai_sampler,
    nai_steps: state.config.nai_steps,
    nai_scale: state.config.nai_scale,
    nai_noise_schedule: state.config.nai_noise_schedule,
    nai_cfg_rescale: state.config.nai_cfg_rescale,
  });
  const noneLabel = localizer(locale, "commands.config.panel.none_label");

  return {
    positiveTags: state.config.image_default_positive_tags ?? [],
    negativeTags: state.config.image_default_negative_tags ?? [],
    sampler: effective.sampler || noneLabel,
    steps: String(effective.steps),
    scale: String(effective.scale),
    noiseSchedule: effective.noiseSchedule || noneLabel,
    cfgRescale: String(effective.cfgRescale),
  };
}
