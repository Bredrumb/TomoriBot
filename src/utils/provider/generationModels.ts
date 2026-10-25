import { hasOptApiKey } from "@/utils/security/crypto";
import type { GenerationModelCapability, GenerationModelSelection } from "@/types/provider/generationModels";
import type { ConfigCatalogModelCapability } from "@/utils/discord/configPanelCatalog";
import { configRepository, llmProviderRepo } from "@/utils/db/repositories";
import type { OpenRouterModelScope } from "@/utils/db/repositories/LlmModelRepository";
import { buildCustomProviderName, isCustomProvider } from "@/utils/provider/customProviderUtils";
import { loadProviderModelChoices } from "@/utils/provider/modelCatalog";
import { getStaticProviderInfo } from "@/utils/provider/providerInfoRegistry";
import { findProviderOption } from "@/utils/provider/providerOptionRegistry";
import {
  loadSavedProvidersForCapability,
  loadUserSavedProvidersForCapability,
} from "@/utils/provider/savedProviderConfig";
import type { VoiceSourceMode } from "@/utils/speech/voiceSourceCapabilities";
import { supportsSpeechMode } from "@/utils/speech/voiceSourceCapabilities";

// Discord limits autocomplete choice names and string values to 100 characters.
export const GENERATION_MODEL_CHOICE_MAX_LENGTH = 100;

export interface GenerationModelChoice extends GenerationModelSelection {
  name: string;
  speechModes?: VoiceSourceMode[];
}

export class GenerationModelUnavailableError extends Error {
  constructor() {
    super("The selected generation model is unavailable in this scope.");
    this.name = "GenerationModelUnavailableError";
  }
}

export function generationModelValue(selection: GenerationModelSelection): string {
  return `${selection.source}:${selection.kind}:${selection.modelId}:${selection.provider}`;
}

export async function loadGenerationModelChoices(
  serverId: number,
  userId: number | null,
  capability: GenerationModelCapability,
): Promise<GenerationModelChoice[]> {
  const config = await configRepository.loadModelCapabilityIds(serverId);
  const scopes: OpenRouterModelScope[] = [
    ...(!config?.user_byok_mode ? [{ kind: "server" as const, ownerId: serverId }] : []),
    ...(userId !== null ? [{ kind: "personal" as const, ownerId: userId }] : []),
  ];
  const groups = await Promise.all(
    scopes.map(async (scope) => {
      const capabilities =
        capability === "speech"
          ? (["speech_design", "speech_clone"] as const)
          : [capability === "image-nai" ? ("image" as const) : capability];
      const result: GenerationModelChoice[] = [];
      for (const savedCapability of capabilities) {
        const providers =
          scope.kind === "server"
            ? await loadSavedProvidersForCapability(scope.ownerId, savedCapability)
            : await loadUserSavedProvidersForCapability(scope.ownerId, savedCapability);
        const providerNames = providers
          .filter((row) => row.api_key !== null || findProviderOption(row.provider))
          .map((row) => row.provider)
          .filter(
            (provider) =>
              capability !== "image-nai" ||
              getStaticProviderInfo(provider)?.featureSupport.imageGeneration === "nai-pipeline",
          );
        if (
          capability === "image-nai" &&
          scope.kind === "server" &&
          !providerNames.includes("novelai") &&
          (await hasOptApiKey(serverId, "novelai"))
        )
          providerNames.push("novelai");
        for (const provider of providerNames) {
          const nai =
            !isCustomProvider(provider) &&
            getStaticProviderInfo(provider)?.featureSupport.imageGeneration === "nai-pipeline";
          const catalogCapability: ConfigCatalogModelCapability =
            savedCapability === "speech_design"
              ? "tts-design"
              : savedCapability === "speech_clone"
                ? "tts-clone"
                : (capability === "image" || capability === "image-nai") && nai
                  ? "nai-image"
                  : (capability as "text" | "image" | "video");
          const choices = await loadProviderModelChoices(scope, catalogCapability, provider);
          result.push(
            ...choices.map(
              (model): GenerationModelChoice => ({
                source: scope.kind,
                provider,
                modelId: model.id,
                kind: (capability === "image" || capability === "image-nai") && nai ? "image-nai" : capability,
                name: model.name,
                ...(capability === "speech"
                  ? { speechModes: [savedCapability === "speech_design" ? "design" : "clone"] }
                  : {}),
              }),
            ),
          );
        }
      }
      if (capability === "speech" && scope.kind === "server") {
        const endpoints = await llmProviderRepo.loadCustomEndpointsForServer(scope.ownerId);
        for (const endpoint of endpoints) {
          if (endpoint.capability !== "speech" || !endpoint.connection_id || !endpoint.custom_endpoint_id) continue;
          const speechModes = (["design", "clone"] as const).filter((mode) => supportsSpeechMode(endpoint, mode));
          if (speechModes.length === 0) continue;
          const provider = buildCustomProviderName(endpoint.connection_id);
          const credentials = await llmProviderRepo.loadSavedProviderConfig(serverId, provider);
          if (endpoint.requires_auth && !credentials?.api_key) continue;
          result.push({
            source: "server",
            kind: "speech-endpoint",
            provider,
            modelId: endpoint.custom_endpoint_id,
            name: endpoint.model_name ?? endpoint.label,
            speechModes,
          });
        }
      }
      return result;
    }),
  );
  const unique = new Map<string, GenerationModelChoice>();
  for (const choice of groups.flat()) {
    const key = generationModelValue(choice);
    if (key.length > GENERATION_MODEL_CHOICE_MAX_LENGTH) continue;
    const existing = unique.get(key);
    if (existing?.speechModes && choice.speechModes) {
      existing.speechModes = [...new Set([...existing.speechModes, ...choice.speechModes])];
    } else {
      unique.set(key, choice);
    }
  }
  return [...unique.values()];
}

export async function validateGenerationModelSelection(
  serverId: number,
  userId: number | null,
  selection: GenerationModelSelection,
): Promise<GenerationModelChoice> {
  const capability = selection.kind === "speech-endpoint" ? "speech" : selection.kind;
  const choices = await loadGenerationModelChoices(serverId, userId, capability);
  const choice = choices.find((entry) => generationModelValue(entry) === generationModelValue(selection));
  if (!choice) throw new GenerationModelUnavailableError();
  const ownerId = choice.source === "server" ? serverId : userId;
  if (ownerId === null) throw new GenerationModelUnavailableError();
  const option = findProviderOption(choice.provider);
  if (
    option?.selection.validateModel &&
    !(await option.selection.validateModel({
      scope: { kind: choice.source, ownerId },
      capability: capability === "image-nai" ? "image" : capability,
      modelCodename: choice.name,
    }))
  )
    throw new GenerationModelUnavailableError();
  return choice;
}
