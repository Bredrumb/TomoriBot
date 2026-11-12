import {
  buildCustomMessages,
  callCustomChatCompletions,
  extractCustomResponseText,
} from "@/providers/custom/customOpenAICompatibleUtils";
import { callCustomStructuredJSON } from "@/providers/custom/customStructuredOutput";
import type {
  CompactConversationResult,
  CompactRoleplayResult,
  ProviderCompactSummaryRequest as CompactSummaryRequest,
} from "@/types/provider/featureInterfaces";
import { buildRoleplaySchema, CompactRoleplaySummarySchema } from "@/providers/utils/compactCommon";
import { normalizeOpenAICompatibleProviderError } from "@/providers/openaiCompatible/openaiCompatibleErrorFormatter";
import { isOperatorActionableProviderError } from "@/utils/provider/providerErrorClassification";
import { redactProviderDetail, reportProviderFailure } from "@/utils/provider/providerErrorMetrics";

export async function generateConversationSummaryCustom(
  request: CompactSummaryRequest,
): Promise<CompactConversationResult> {
  try {
    const messages = await buildCustomMessages({
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      images: request.images,
    });

    const body: Record<string, unknown> = {
      ...(request.model !== "other-model" ? { model: request.model } : {}),
      messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: 4096,
      stream: false,
    };

    const response = await callCustomChatCompletions({
      endpointUrl: request.endpointUrl,
      apiKey: request.apiKey,
      body,
      logLabel: "Custom compact summary",
      messagesForLog: messages as Array<Record<string, unknown>>,
      privateOutput: true,
    });

    if (!response.success) {
      await reportCustomSummaryFailure(
        request,
        new Error(`HTTP ${response.error.status}: ${response.error.errorBody}`),
        response.error.status,
      );
      return {
        error:
          response.error.status === 0
            ? response.error.errorBody
            : `Custom endpoint request failed (${response.error.status}): ${response.error.statusText}`,
      };
    }

    const responseText = extractCustomResponseText(response.data.choices?.[0]?.message?.content);
    if (!responseText) {
      return {
        error: "Custom endpoint returned an empty response.",
      };
    }

    return {
      summary: responseText,
    };
  } catch (error) {
    await reportCustomSummaryFailure(request, error);
    return {
      error: error instanceof Error ? error.message : "Unknown custom endpoint error",
    };
  }
}

async function reportCustomSummaryFailure(
  request: CompactSummaryRequest,
  error: unknown,
  status?: number,
): Promise<void> {
  const providerError = normalizeOpenAICompatibleProviderError(error, { errorMessagePrefix: "Custom compact summary" });
  await reportProviderFailure({
    summary: "Custom compact summary request failed",
    errorType: "CustomCompactSummaryHttpError",
    error,
    expected: !request.endpointUrl?.trim() || !isOperatorActionableProviderError(providerError),
    detail: redactProviderDetail(error instanceof Error ? error.message : String(error), request.apiKey),
    dimensions: { operation: "compact-summary", provider: "custom", status: status ?? "none" },
    metadata: { model: request.model },
    redactValues: [request.apiKey],
  });
}

export async function generateRoleplaySummaryCustom(request: CompactSummaryRequest): Promise<CompactRoleplayResult> {
  const result = await callCustomStructuredJSON(
    {
      ...request,
      systemPrompt: request.systemPrompt ?? "",
      schemaName: "roleplay_summary",
    },
    buildRoleplaySchema(),
    CompactRoleplaySummarySchema,
  );

  if (!result.success) {
    return {
      error: result.error,
    };
  }

  return {
    summary: result.data,
  };
}
