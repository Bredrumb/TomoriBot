/**
 * Conversation compaction for the Z.ai provider (shared with Zaicoding).
 *
 * - Plain-text conversation summaries via direct POST to the Z.ai
 *   chat-completions endpoint.
 * - Roleplay structured summaries delegated to callZaiStructuredJSON,
 *   which handles json_object mode + prompt steering + Zod validation.
 *
 * Both functions accept an optional `endpointUrl` override so the same
 * generators can be reused by the Zaicoding provider with its own endpoint.
 */
import { log } from "@/utils/misc/logger";
import type {
  CompactConversationResult,
  CompactRoleplayResult,
  ProviderCompactSummaryRequest,
} from "@/types/provider/featureInterfaces";
import { callZaiStructuredJSON } from "@/providers/zai/zaiStructuredOutput";
import { toZaiApiModelName, ZAI_GENERAL_CHAT_COMPLETIONS_URL, ZAI_REASONING_MODELS } from "@/providers/zai/zaiShared";
import { buildRoleplaySchema, CompactRoleplaySummarySchema } from "@/providers/utils/compactCommon";

/**
 * Generate a plain-text conversation summary using the Z.ai API.
 *
 * @param request - Compact summary request with model, prompts, and auth
 * @param endpointUrl - Override endpoint URL (defaults to ZAI_GENERAL_CHAT_COMPLETIONS_URL)
 * @returns Plain-text summary or an error object
 */
export async function generateConversationSummaryZai(
  request: ProviderCompactSummaryRequest,
  endpointUrl?: string,
): Promise<CompactConversationResult> {
  try {
    if (!request.apiKey || request.apiKey.trim().length < 10) {
      return { error: "Invalid Z.ai API key" };
    }

    // Strip the zai/ prefix so the API receives the raw model name
    const apiModel = toZaiApiModelName(request.model);

    // Build the message array
    const messages: Array<Record<string, unknown>> = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: request.userPrompt });

    // Build the request body
    const body: Record<string, unknown> = {
      model: apiModel,
      messages,
      max_tokens: 4096,
      stream: false,
    };

    // Skip temperature for reasoning models (they don't support it)
    if (!ZAI_REASONING_MODELS.includes(apiModel)) {
      body.temperature = request.temperature ?? 0.7;
    }

    // Send the request
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
      log.error("Z.ai compact summary request failed", new Error(errorBody), {
        errorType: "ZaiCompactHttpError",
        metadata: {
          model: apiModel,
          status: response.status,
          errorBody,
        },
      });
      return {
        error: `Z.ai request failed (${response.status}): ${response.statusText}`,
      };
    }

    // Extract the response text
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
    log.error("Z.ai compact summary failed", error as Error);
    return {
      error: error instanceof Error ? error.message : "Unknown Z.ai error",
    };
  }
}

/**
 * Generate a structured roleplay summary using the Z.ai API.
 *
 * Delegates to callZaiStructuredJSON, which uses json_object mode with
 * schema/example injected into the system prompt and Zod validation.
 *
 * @param request - Compact summary request with model, prompts, and auth
 * @param endpointUrl - Override endpoint URL (defaults to ZAI_GENERAL_CHAT_COMPLETIONS_URL)
 * @returns Structured roleplay summary or an error object
 */
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
