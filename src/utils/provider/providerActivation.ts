import type { SavedProviderConfigRow, SavedProviderConfigUpsert, TomoriState } from "@/types/db/schema";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository, llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";
import { buildFallbackModelPersistence } from "@/utils/provider/fallbackModelIdentity";
import { setPersonalTextPrimary } from "@/utils/provider/personalProviderHelpers";
import { resolveLogitBiasEntriesForLlm } from "@/utils/provider/logitBiasResolver";
import type { OpenRouterModelScope } from "@/utils/db/repositories/LlmModelRepository";
import {
  hasSpeechDesignSelection,
  hasTranscriptionSelection,
  setHostedSpeechSelection,
  setHostedTranscriptionSelection,
} from "@/utils/db/repositories/SpeechRepository";
import { validateOpenRouterSpeechModel } from "@/utils/cache/openrouterSpeechModelCache";
import { validateOpenRouterTranscriptionModel } from "@/utils/cache/openrouterTranscriptionModelCache";
import { log } from "@/utils/misc/logger";
import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";

// OpenRouter's design default only fills an empty slot so adding or re-keying OpenRouter never overwrites an existing
// Gemini or Vertex design.
export async function activateProviderSpeechDefaults(scope: OpenRouterModelScope, provider: string): Promise<boolean> {
  const models = await llmModelRepo.loadAvailableSpeechModels(provider, scope);
  for (const mode of ["clone", "design"] as const) {
    const model = models.find((entry) => entry.is_default && entry.voice_mode === mode);
    if (!model) continue;
    if (provider === "openrouter" && mode === "design" && (await hasSpeechDesignSelection(scope))) continue;
    if (provider === "openrouter" && !(await validateOpenRouterSpeechModel(model.codename, mode))) return false;
    if (!(await setHostedSpeechSelection(scope, model.speech_model_id, mode))) return false;
  }
  return true;
}

// Existing transcription selections are preserved so adding or re-keying another provider never overwrites the
// owner's current target.
export async function activateProviderTranscriptionDefault(
  scope: OpenRouterModelScope,
  provider: string,
): Promise<boolean> {
  const model = (await llmModelRepo.loadAvailableTranscriptionModels(provider, scope)).find(
    (entry) => entry.is_default,
  );
  if (!model || (await hasTranscriptionSelection(scope))) return true;
  if (provider === "openrouter" && !(await validateOpenRouterTranscriptionModel(model.codename))) {
    log.warn("Skipped the OpenRouter transcription default missing from the live catalogue", undefined, {
      metadata: { scope, codename: model.codename },
    });
    return true;
  }
  return setHostedTranscriptionSelection(scope, model.transcription_model_id);
}

type ActivationStatus = "activated" | "missing_model" | "missing_provider" | "update_failed";

export interface ActivationResult {
  status: ActivationStatus;
  modelName?: string;
}

type ServerSavedProviderConfig = SavedProviderConfigRow | SavedProviderConfigUpsert;

export async function activateServerTextModelFromSavedConfig(params: {
  serverDiscId: string;
  tomoriState: TomoriState;
  savedConfig: ServerSavedProviderConfig;
  llmId?: number | null;
}): Promise<ActivationResult> {
  const targetLlmId = params.llmId ?? params.savedConfig.llm_id;
  if (!targetLlmId) {
    return { status: "missing_model" };
  }

  const selectedModel = await llmModelRepo.loadById(targetLlmId);
  if (!selectedModel?.llm_id) {
    return { status: "missing_model" };
  }

  const promotedLlmId = selectedModel.llm_id;
  const normalizedProvider = params.savedConfig.provider.toLowerCase();
  const resetNovelAI = normalizedProvider === "novelai" && params.tomoriState.llm.llm_id !== selectedModel.llm_id;
  const preset = resetNovelAI ? await configRepository.resolveNaiPreset(selectedModel.llm_codename) : undefined;
  if (resetNovelAI && getNovelAIProfile(selectedModel.llm_codename).samplingPresetTarget && !preset) {
    return { status: "update_failed" };
  }
  const customEndpoints = isCustomProvider(normalizedProvider)
    ? await llmProviderRepo.loadCustomEndpointsForServer(params.tomoriState.server_id)
    : [];
  // Keep cross-provider fallback entries intact and prune only entries resolving to the promoted primary model.
  const { fallbackModelRefs, fallbackLlmIds } = buildFallbackModelPersistence(
    params.tomoriState.config.fallback_model_refs ?? [],
    promotedLlmId,
    customEndpoints,
  );
  const resolvedLogitBiases = resolveLogitBiasEntriesForLlm(
    params.savedConfig.llm_logit_biases ?? params.tomoriState.config.llm_logit_biases ?? [],
    selectedModel,
  );

  const [updatedModel, updatedChat] = await Promise.all([
    configRepository.updateModelConfig(params.tomoriState.server_id, {
      llm_id: selectedModel.llm_id,
      api_key: params.savedConfig.api_key,
      key_version: params.savedConfig.key_version ?? 1,
      thinking_level: params.savedConfig.thinking_level ?? "auto",
      fallback_llm_ids: fallbackLlmIds,
      llm_temperature: params.savedConfig.llm_temperature ?? params.tomoriState.config.llm_temperature ?? 1.0,
      llm_disabled_params: params.savedConfig.llm_disabled_params ?? [],
      custom_model_name: null,
      custom_endpoint_url: null,
      custom_num_ctx: null,
    }),
    configRepository.updateChatConfig(params.tomoriState.server_id, {
      llm_top_p: params.savedConfig.llm_top_p ?? params.tomoriState.config.llm_top_p ?? 0.95,
      llm_top_k: params.savedConfig.llm_top_k ?? params.tomoriState.config.llm_top_k ?? 0,
      llm_frequency_penalty:
        params.savedConfig.llm_frequency_penalty ?? params.tomoriState.config.llm_frequency_penalty ?? 0.0,
      llm_presence_penalty:
        params.savedConfig.llm_presence_penalty ?? params.tomoriState.config.llm_presence_penalty ?? 0.0,
      llm_min_p: params.savedConfig.llm_min_p ?? params.tomoriState.config.llm_min_p ?? 0.05,
      llm_logit_biases: resolvedLogitBiases.entries,
      fallback_model_refs: fallbackModelRefs,
    }),
  ]);

  if (updatedModel || updatedChat) invalidateTomoriStateCache(params.serverDiscId);
  if (!updatedModel || !updatedChat) {
    return { status: "update_failed" };
  }
  if (
    resetNovelAI &&
    !(await configRepository.applyNaiPreset(
      params.tomoriState.server_id,
      preset ?? null,
      selectedModel,
      params.serverDiscId,
    ))
  ) {
    return { status: "update_failed" };
  }
  return { status: "activated", modelName: selectedModel.llm_codename };
}

export async function activatePersonalProviderTextModel(params: {
  userId: number;
  provider: string;
  llmId: number | null | undefined;
}): Promise<ActivationResult> {
  if (!params.llmId) {
    return { status: "missing_model" };
  }

  const selectedModel = await llmModelRepo.loadById(params.llmId);
  if (!selectedModel?.llm_id) {
    return { status: "missing_model" };
  }

  const customEndpoints = isCustomProvider(params.provider)
    ? await llmProviderRepo.loadCustomEndpointsForUser(params.userId)
    : [];
  const updated = await setPersonalTextPrimary(params.userId, params.provider, selectedModel.llm_id, customEndpoints);

  return updated ? { status: "activated", modelName: selectedModel.llm_codename } : { status: "update_failed" };
}
