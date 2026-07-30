import { CUSTOM_PROVIDER_PLACEHOLDER_API_KEY, normalizeCustomApiUrl } from "@/providers/custom/customStreamAdapter";
import { logSanitizedOpenAICompatibleRequest } from "@/providers/openaiCompatible/openaiCompatibleMessageBuilder";
import type { ProviderImageInput } from "@/types/provider/featureInterfaces";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";
import { log } from "@/utils/misc/logger";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";

export type CustomContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type CustomMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | CustomContentPart[] };

export interface CustomChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

export interface CustomChatCompletionError {
  status: number;
  statusText: string;
  errorBody: string;
}

export function buildCustomHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey.trim() !== "" && apiKey !== CUSTOM_PROVIDER_PLACEHOLDER_API_KEY) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

export async function buildCustomUserContent(
  userPrompt: string,
  images?: ProviderImageInput[],
): Promise<string | CustomContentPart[]> {
  if (!images || images.length === 0) {
    return userPrompt;
  }

  const contentParts: CustomContentPart[] = [{ type: "text", text: userPrompt }];

  for (const image of images) {
    try {
      const optimized = await fetchAndOptimizeImage(image.url, image.mimeType);
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${optimized.mimeType};base64,${optimized.data}`,
        },
      });
    } catch (fetchError) {
      log.error(`Error fetching custom provider image ${image.name ?? image.url}`, fetchError as Error, {
        errorType: "CustomProviderImageFetchError",
        metadata: {
          imageName: image.name ?? null,
          imageUrl: image.url,
        },
      });
    }
  }

  return contentParts.length === 1 ? userPrompt : contentParts;
}

export async function buildCustomMessages(params: {
  systemPrompt?: string;
  userPrompt: string;
  images?: ProviderImageInput[];
}): Promise<CustomMessage[]> {
  const messages: CustomMessage[] = [];

  if (params.systemPrompt?.trim()) {
    messages.push({
      role: "system",
      content: params.systemPrompt,
    });
  }

  messages.push({
    role: "user",
    content: await buildCustomUserContent(params.userPrompt, params.images),
  });

  return messages;
}

export async function callCustomChatCompletions(params: {
  endpointUrl?: string;
  apiKey: string;
  body: Record<string, unknown>;
  logLabel: string;
  messagesForLog?: Array<Record<string, unknown>>;
}): Promise<
  { success: true; data: CustomChatCompletionResponse } | { success: false; error: CustomChatCompletionError }
> {
  if (!params.endpointUrl?.trim()) {
    return {
      success: false,
      error: {
        status: 0,
        statusText: "Missing endpoint URL",
        errorBody: "Custom endpoint URL is not configured.",
      },
    };
  }

  if (params.messagesForLog) {
    logSanitizedOpenAICompatibleRequest(params.logLabel, params.messagesForLog);
  }

  try {
    const response = await fetchUserRemoteUrl(normalizeCustomApiUrl(params.endpointUrl), {
      method: "POST",
      headers: buildCustomHeaders(params.apiKey),
      body: JSON.stringify(params.body),
    });

    if (!response.ok) {
      return {
        success: false,
        error: {
          status: response.status,
          statusText: response.statusText,
          errorBody: await response.text(),
        },
      };
    }

    return {
      success: true,
      data: (await response.json()) as CustomChatCompletionResponse,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        status: 0,
        statusText: "Request failed",
        errorBody: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function extractCustomResponseText(messageContent: unknown): string {
  if (typeof messageContent === "string") {
    return messageContent.trim();
  }

  if (!Array.isArray(messageContent)) {
    return "";
  }

  return messageContent
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        (part as { type?: string }).type === "text" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("")
    .trim();
}

export function buildExampleJsonFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") {
    return {};
  }

  const record = schema as Record<string, unknown>;

  if ("const" in record) {
    return record.const;
  }

  if (Array.isArray(record.enum) && record.enum.length > 0) {
    return record.enum[0];
  }

  if (Array.isArray(record.anyOf) && record.anyOf.length > 0) {
    return buildExampleJsonFromSchema(record.anyOf[0]);
  }

  const schemaType = record.type;
  if (schemaType === "object") {
    const properties =
      record.properties && typeof record.properties === "object" ? (record.properties as Record<string, unknown>) : {};
    const example: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      example[key] = buildExampleJsonFromSchema(value);
    }
    return example;
  }

  if (schemaType === "array") {
    return [buildExampleJsonFromSchema(record.items)];
  }

  if (schemaType === "integer" || schemaType === "number") {
    const minimum = typeof record.minimum === "number" && Number.isFinite(record.minimum) ? record.minimum : 0;
    return minimum;
  }

  if (schemaType === "boolean") {
    return false;
  }

  if (schemaType === "string") {
    return "<string>";
  }

  return {};
}

export function buildSchemaSteeredSystemPrompt(
  systemPrompt: string,
  responseSchema: Record<string, unknown>,
  schemaName?: string,
): string {
  const schemaLabel = schemaName ?? "structured_output_result";
  const exampleObject = buildExampleJsonFromSchema(responseSchema);

  return [
    systemPrompt.trim(),
    "Return a valid JSON object only.",
    `Target JSON schema for ${schemaLabel}:`,
    JSON.stringify(responseSchema, null, 2),
    "Example JSON object:",
    JSON.stringify(exampleObject, null, 2),
    "Do not include <think> tags, reasoning summaries, or any text outside the JSON.",
    "Do not wrap the JSON in markdown fences and do not add extra prose.",
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

export function shouldFallbackStructuredMode(status: number, errorBody: string): boolean {
  if (status !== 400 && status !== 422) {
    return false;
  }

  const normalized = errorBody.toLowerCase();
  const mentionsStructuredOutput =
    normalized.includes("response_format") ||
    normalized.includes("json_schema") ||
    normalized.includes("json_object") ||
    normalized.includes("schema");
  const indicatesUnsupportedParam =
    normalized.includes("unsupported") ||
    normalized.includes("unknown") ||
    normalized.includes("invalid") ||
    normalized.includes("not allowed") ||
    normalized.includes("unrecognized");

  return mentionsStructuredOutput && indicatesUnsupportedParam;
}

function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
}

export function parseCustomJsonResponse(text: string): unknown {
  const cleanedText = stripThinkBlocks(text);

  try {
    return JSON.parse(cleanedText);
  } catch {}

  const fencedMatch = cleanedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1]);
  }

  const firstBracket = cleanedText.indexOf("[");
  const lastBracket = cleanedText.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return JSON.parse(cleanedText.slice(firstBracket, lastBracket + 1));
  }

  const firstBrace = cleanedText.indexOf("{");
  const lastBrace = cleanedText.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(cleanedText.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("Invalid JSON response from custom endpoint.");
}
