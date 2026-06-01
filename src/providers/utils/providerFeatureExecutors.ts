import type {
  GeneratePresetParams,
  PresetGenerationResult,
  CompactConversationResult,
  CompactRoleplayResult,
  ProviderCompactSummaryRequest as ProviderCapabilityCompactSummaryRequest,
  ProviderPresetGenerationRequest as ProviderCapabilityPresetGenerationRequest,
  StructuredOutputResult,
} from "@/types/provider/featureInterfaces";
import {
  buildExpressionResponseSchema,
  type ExpressionBatchResult,
  ExpressionBatchResultSchema,
} from "@/providers/utils/structuredOutput";
import {
  buildHistoryExtractionResponseSchema,
  HistoryExtractionResultSchema,
  type HistoryMemoryEntry,
} from "@/providers/utils/historyExtractionSchema";
import type { TomoriState } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";
import {
  resolveConversationCompactionCapability,
  resolvePresetGenerationCapability,
  resolveStructuredOutputCapability,
} from "@/utils/provider/providerCapabilityResolver";

export interface ProviderPresetGenerationRequest {
  providerName: string;
  apiKey: string;
  tomoriState: TomoriState;
  params: GeneratePresetParams;
  locale: string;
  toolContext?: ToolContext;
  maxToolRounds?: number;
}

export interface ProviderCompactSummaryRequest extends ProviderCapabilityCompactSummaryRequest {
  providerName: string;
}

export interface ProviderExpressionInitializationRequest {
  providerName: string;
  apiKey: string;
  model: string;
  endpointUrl?: string;
  systemPrompt: string;
  userPrompt: string;
  images: Array<{ url: string; name: string }>;
  temperature?: number;
}

export interface ProviderHistoryExtractionRequest {
  providerName: string;
  apiKey: string;
  model: string;
  endpointUrl?: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export async function generatePresetForProvider(
  request: ProviderPresetGenerationRequest,
): Promise<PresetGenerationResult> {
  const capability = await resolvePresetGenerationCapability(request.providerName);
  if (!capability) {
    return {
      error: `Preset generation is not implemented for provider ${request.providerName}.`,
      errorType: "MODEL_ERROR",
    };
  }

  const capabilityRequest: ProviderCapabilityPresetGenerationRequest = {
    apiKey: request.apiKey,
    locale: request.locale,
    params: request.params,
    tomoriState: request.tomoriState,
    toolContext: request.toolContext,
    maxToolRounds: request.maxToolRounds,
  };

  return await capability.generatePreset(capabilityRequest);
}

export async function generateConversationSummaryForProvider(
  request: ProviderCompactSummaryRequest,
): Promise<CompactConversationResult> {
  const capability = await resolveConversationCompactionCapability(request.providerName);
  if (!capability) {
    return {
      error: `Conversation compaction is not implemented for provider ${request.providerName}.`,
    };
  }

  return await capability.generateConversationSummary(request);
}

export async function generateRoleplaySummaryForProvider(
  request: ProviderCompactSummaryRequest,
): Promise<CompactRoleplayResult> {
  const capability = await resolveConversationCompactionCapability(request.providerName);
  if (!capability) {
    return {
      error: `Roleplay compaction is not implemented for provider ${request.providerName}.`,
    };
  }

  return await capability.generateRoleplaySummary(request);
}

export async function callExpressionInitializationForProvider(
  request: ProviderExpressionInitializationRequest,
): Promise<StructuredOutputResult<ExpressionBatchResult>> {
  const capability = await resolveStructuredOutputCapability(request.providerName);
  if (!capability) {
    return {
      success: false,
      error: `Expression initialization is not implemented for provider ${request.providerName}.`,
    };
  }

  return await capability.callStructuredJSON(
    {
      apiKey: request.apiKey,
      model: request.model,
      endpointUrl: request.endpointUrl,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      images: request.images,
      temperature: request.temperature,
      schemaName: "expression_batch_result",
    },
    buildExpressionResponseSchema(),
    ExpressionBatchResultSchema,
  );
}

export async function extractHistoryWindowForProvider(
  request: ProviderHistoryExtractionRequest,
): Promise<HistoryMemoryEntry[]> {
  const capability = await resolveStructuredOutputCapability(request.providerName);
  if (!capability) {
    log.warn(`History extraction is not implemented for provider ${request.providerName}.`);
    return [];
  }

  const responseSchema = buildHistoryExtractionResponseSchema();
  const structuredRequest = {
    apiKey: request.apiKey,
    model: request.model,
    endpointUrl: request.endpointUrl,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    temperature: request.temperature,
    maxOutputTokens: request.maxOutputTokens,
    schemaName: "history_extraction_result",
  };

  const result = await capability.callStructuredJSON(structuredRequest, responseSchema, HistoryExtractionResultSchema);

  if (result.success) {
    return result.data.memories;
  }

  log.warn(`History extraction failed (${request.providerName}): ${result.error}`);
  return [];
}
