import { log } from "@/utils/misc/logger";
import type {
  CompactConversationResult,
  CompactRoleplayResult,
  ProviderCompactSummaryRequest,
} from "@/types/provider/featureInterfaces";
import { callZaiStructuredJSON } from "@/providers/zai/zaiStructuredOutput";
import { toZaiApiModelName, ZAI_GENERAL_CHAT_COMPLETIONS_URL, ZAI_REASONING_MODELS } from "@/providers/zai/zaiShared";
import { buildRoleplaySchema, CompactRoleplaySummarySchema } from "@/providers/utils/compactCommon";

export async function generateConversationSummaryZai(
  request: ProviderCompactSummaryRequest,
  endpointUrl?: string,
): Promise<CompactConversationResult> {
  try {
    if (!request.apiKey || request.apiKey.trim().length < 10) {
      return { error: "Invalid Z.ai API key" };
    }

    const apiModel = toZaiApiModelName(request.model);

    const messages: Array<Record<string, unknown>> = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: request.userPrompt });

    const body: Record<string, unknown> = {
      model: apiModel,
      messages,
      max_tokens: 4096,
      stream: false,
    };

    // Omit temperature because Z.ai reasoning models reject it.
    if (!ZAI_REASONING_MODELS.includes(apiModel)) {
      body.temperature = request.temperature ?? 0.7;
    }

    const response = await fetch(endpointUrl ?? ZAI_GENERAL_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      if (!request.deferFailureReport) {
        log.error("Z.ai compact summary request failed", new Error(errorBody), {
          errorType: "ZaiCompactHttpError",
          metadata: {
            model: apiModel,
            status: response.status,
            errorBody,
          },
        });
      }
      return {
        error: `Z.ai request failed (${response.status}): ${response.statusText}`,
        cause: Object.assign(new Error("Provider request failed"), {
          status: response.status,
          responseBody: errorBody.replaceAll(request.apiKey, "[REDACTED]"),
        }),
      };
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = result.choices?.[0]?.message?.content;
    const responseText = typeof content === "string" ? content.trim() : "";

    if (!responseText) {
      return { error: "Z.ai returned an empty response." };
    }

    return { summary: responseText };
  } catch (error) {
    if (!request.deferFailureReport) log.error("Z.ai compact summary failed", error as Error);
    return {
      cause: error instanceof Error ? error : undefined,
      error: error instanceof Error ? error.message : "Unknown Z.ai error",
    };
  }
}

export async function generateRoleplaySummaryZai(
  request: ProviderCompactSummaryRequest,
  endpointUrl?: string,
): Promise<CompactRoleplayResult> {
  const result = await callZaiStructuredJSON(
    {
      apiKey: request.apiKey,
      model: request.model,
      endpointUrl,
      systemPrompt: request.systemPrompt ?? "",
      userPrompt: request.userPrompt,
      temperature: request.temperature,
      schemaName: "roleplay_summary",
    },
    buildRoleplaySchema(),
    CompactRoleplaySummarySchema,
  );

  if (!result.success) {
    return { error: result.error };
  }

  return { summary: result.data };
}
