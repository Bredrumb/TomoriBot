import type {
  CustomEndpointRow,
  DiffusionModelRow,
  EmbeddingModelRow,
  LlmRow,
  VideoGenerationModelRow,
} from "@/types/db/schema";
import { loadDecisionModelsForScope } from "@/providers/utils/providerFeatureExecutors";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import type { OpenRouterModelScope } from "@/utils/db/repositories/LlmModelRepository";
import type { ConfigCatalogModelCapability } from "@/utils/discord/configPanelCatalog";
import { isCustomProvider, parseCustomProvider } from "@/utils/provider/customProviderUtils";
import {
  findProviderOption,
  providerOptionOffersModelViewCapability,
  type ProviderOptionModelViewCapability,
} from "@/utils/provider/providerOptionRegistry";
import { supportsSpeechMode } from "@/utils/speech/voiceSourceCapabilities";
import { resolveDescription } from "@/utils/text/localizer";

export interface ProviderModelChoice {
  id: number;
  name: string;
  description: string | null;
}

export async function loadProviderModelChoices(
  owner: OpenRouterModelScope,
  capability: ConfigCatalogModelCapability,
  provider: string,
  locale = "en-US",
  textModelFilter?: (model: LlmRow) => boolean,
): Promise<ProviderModelChoice[]> {
  const option = findProviderOption(provider);
  if (option) {
    if (!providerOptionOffersModelViewCapability(option, capability as ProviderOptionModelViewCapability)) return [];
    if (!(await option.availability(owner)).eligible) return [];
    provider = option.catalogProvider;
  }
  switch (capability) {
    case "text":
    case "vision": {
      const models = (await llmModelRepo.loadAvailableModelsForProvider(provider, false, owner)) ?? [];
      const eligible = capability === "vision" ? models.filter((model) => model.sees_images) : models;
      return eligible
        .filter((model) => !textModelFilter || textModelFilter(model))
        .filter((model): model is LlmRow & { llm_id: number } => model.llm_id !== undefined)
        .map((model) => ({
          id: model.llm_id,
          name: model.llm_codename,
          description: resolveDescription(model.descriptions, locale),
        }));
    }
    case "embedding": {
      const models = (await llmModelRepo.loadAvailableEmbeddingModels(provider, false, owner)) ?? [];
      return models
        .filter(
          (model): model is EmbeddingModelRow & { embedding_model_id: number } =>
            model.embedding_model_id !== undefined && model.embedding_model_id !== null,
        )
        .map((model) => ({
          id: model.embedding_model_id,
          name: model.codename,
          description: resolveDescription(model.descriptions, locale),
        }));
    }
    case "decision":
      return (await loadDecisionModelsForScope(owner, option?.value))
        .filter(({ model }) => model.provider === provider)
        .map(({ model }) => ({
          id: model.decision_model_id,
          name: model.codename,
          description: resolveDescription(model.descriptions, locale),
        }));
    case "image":
    case "nai-image": {
      const models = (await llmModelRepo.loadAvailableDiffusionModels(provider, false, owner)) ?? [];
      return models
        .filter(
          (model): model is DiffusionModelRow & { diffusion_model_id: number } =>
            model.diffusion_model_id !== undefined && model.diffusion_model_id !== null,
        )
        .map((model) => ({
          id: model.diffusion_model_id,
          name: model.codename,
          description: resolveDescription(model.descriptions, locale),
        }));
    }
    case "video": {
      const models = (await llmModelRepo.loadAvailableVideoGenerationModels(provider, false, owner)) ?? [];
      return models
        .filter(
          (model): model is VideoGenerationModelRow & { video_model_id: number } =>
            model.video_model_id !== undefined && model.video_model_id !== null,
        )
        .map((model) => ({
          id: model.video_model_id,
          name: model.codename,
          description: resolveDescription(model.descriptions, locale),
        }));
    }
    case "tts-design":
    case "tts-clone": {
      const mode = capability === "tts-design" ? "design" : "clone";
      if (isCustomProvider(provider)) {
        const connectionId = parseCustomProvider(provider)?.connectionId;
        return (owner.kind === "server" ? await llmProviderRepo.loadCustomEndpointsForServer(owner.ownerId) : [])
          .filter(
            (endpoint): endpoint is CustomEndpointRow & { custom_endpoint_id: number } =>
              endpoint.capability === "speech" &&
              supportsSpeechMode(endpoint, mode) &&
              endpoint.connection_id === connectionId &&
              endpoint.custom_endpoint_id !== undefined,
          )
          .map((endpoint) => ({
            id: endpoint.custom_endpoint_id,
            name: endpoint.model_name ?? endpoint.label,
            description: null,
          }));
      }
      return (await llmModelRepo.loadAvailableSpeechModels(provider, owner))
        .filter((model) => supportsSpeechMode(model, mode))
        .map((model) => ({
          id: model.speech_model_id,
          name: model.codename,
          description: resolveDescription(model.descriptions, locale),
        }));
    }
  }
}
