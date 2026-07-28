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

/**
 * Outcome of a single history-extraction window.
 *
 * Distinguishes a genuine empty result (`ok: true` with zero entries) from a real
 * failure, so callers can tell "this window held nothing worth extracting" apart from
 * "the model/provider could not produce structured output". Collapsing both into an
 * empty array is what previously surfaced provider errors as "No Facts Extracted".
 */
export type HistoryExtractionOutcome =
  /** `discarded` counts entries the model returned that could not be validated. */
  | { ok: true; entries: HistoryMemoryEntry[]; discarded: number }
  /** `unsupported`: provider exposes no structured-output capability at all. `failed`: the call itself errored. */
  | { ok: false; reason: "unsupported" | "failed"; error: string };

export async function extractHistoryWindowForProvider(
  request: ProviderHistoryExtractionRequest,
): Promise<HistoryExtractionOutcome> {
  const capability = await resolveStructuredOutputCapability(request.providerName);
  if (!capability) {
    const error = `History extraction is not implemented for provider ${request.providerName}.`;
    log.warn(error);
    return { ok: false, reason: "unsupported", error };
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
    if (result.data.discarded > 0) {
      log.warn(
        `History extraction (${request.providerName}) discarded ${result.data.discarded} malformed ` +
          `entries, keeping ${result.data.memories.length}.`,
      );
    }
    return { ok: true, entries: result.data.memories, discarded: result.data.discarded };
  }

  log.warn(`History extraction failed (${request.providerName}): ${result.error}`);
  return { ok: false, reason: "failed", error: result.error };
}
