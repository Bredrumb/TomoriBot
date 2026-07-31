/**
 * AI-Powered Preset Generation for TomoriBot
 * Uses OpenRouter structured output with optional tool-assisted web search.
 */

import { log } from "@/utils/misc/logger";
import { sanitizeSampleDialogueText } from "@/providers/google/presetGenerator";
import type { GeneratePresetParams, PresetGenerationResult } from "@/types/provider/featureInterfaces";
import type { ToolContext } from "@/types/tool/interfaces";
import { executeTool } from "@/tools/toolRegistry";
import { getOpenRouterSupportedParameters } from "@/utils/cache/openrouterCapabilityCache";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { getOpenrouterToolAdapter } from "./openrouterToolAdapter";
import { buildOpenrouterProviderRouting } from "./providerRouting";
import {
  buildPresetResponseSchema,
  buildPresetPrompt,
  extractResponseText,
  buildToolErrorResult,
  stripAnthropicUnsupportedConstraints,
  type PresetContentPart,
  type PresetMessage,
  type PresetToolCall,
} from "@/providers/utils/presetCommon";

interface OpenrouterPresetGenerationOptions {
  model: string;
  temperature?: number;
  tools?: Array<Record<string, unknown>>;
  toolContext?: ToolContext;
  maxToolRounds?: number;
}

/**
 * Generate preset data from user prompts using OpenRouter structured output
 *
 * @param _locale - User's locale for error messages
 * @returns Promise<PresetGenerationResult> - Generated preset or error
 */
export async function generatePresetFromPromptOpenrouter(
  apiKey: string,
  params: GeneratePresetParams,
  _locale: string,
  options: OpenrouterPresetGenerationOptions,
): Promise<PresetGenerationResult> {
  if (!apiKey || apiKey.trim().length < 10) {
    return {
      error: "Invalid OpenRouter API key",
      errorType: "API_KEY",
    };
  }

  const openrouterAdapter = getOpenrouterToolAdapter();
  const tools = options.tools ?? [];
  const toolContext = options.toolContext;
  const toolsEnabled = tools.length > 0 && toolContext;

  const rawPresetSchema = buildPresetResponseSchema();
  const presetSchema = options.model.startsWith("anthropic/")
    ? stripAnthropicUnsupportedConstraints(rawPresetSchema)
    : rawPresetSchema;

  const responseFormat = {
    type: "json_schema" as const,
    json_schema: {
      name: "preset_export_data",
      description: "Structured persona preset data",
      schema: presetSchema,
    },
  };

  const contentParts: PresetContentPart[] = [{ type: "text", text: buildPresetPrompt(params) }];

  if (params.imageBase64 && params.imageMimeType) {
    contentParts.push({
      type: "image_url",
      image_url: {
        url: `data:${params.imageMimeType};base64,${params.imageBase64}`,
      },
    });
    log.info("OpenRouter preset generation: image included in prompt");
  }

  const userContent =
    contentParts.length === 1 && contentParts[0].type === "text" ? contentParts[0].text : contentParts;

  const messages: PresetMessage[] = [
    {
      role: "user",
      content: userContent,
    },
  ];

  const maxToolRounds = options.maxToolRounds ?? 3;
  let toolRounds = 0;

  while (true) {
    const body: Record<string, unknown> = {
      ...(options.model !== "other-model" ? { model: options.model } : {}),
      messages,
      temperature: options.temperature ?? 1.0,
      max_tokens: 8192,
      response_format: responseFormat,
      plugins: [{ id: "response-healing" }],
      stream: false,
    };

    if (toolsEnabled) {
      body.tools = tools;
      const providerRouting = buildOpenrouterProviderRouting({ hasTools: true });
      if (providerRouting) {
        body.provider = providerRouting;
      }

      // OpenRouter defaults tool_choice to automatic selection when omitted.
      // Only send it when the model explicitly advertises support.
      const supportedParameters =
        options.model !== "other-model" ? getOpenRouterSupportedParameters(options.model) : undefined;
      if (supportedParameters?.has("tool_choice")) {
        body.tool_choice = "auto";
      }
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...buildOpenRouterAttributionHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error("OpenRouter preset generation request failed", new Error(errorBody), {
        errorType: "OpenrouterPresetHttpError",
        metadata: {
          model: options.model,
          status: response.status,
          errorBody,
        },
      });
      return {
        error: `OpenRouter request failed (${response.status}): ${response.statusText}`,
        errorType: "CONNECTION",
      };
    }

    const result = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: unknown;
          tool_calls?: PresetToolCall[];
        };
      }>;
    };

    const message = result.choices?.[0]?.message;
    if (!message) {
      return {
        error: "OpenRouter returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length > 0) {
      if (!toolsEnabled || !toolContext) {
        return {
          error: "OpenRouter requested tool calls but tools are not available.",
          errorType: "MODEL_ERROR",
        };
      }

      toolRounds += 1;
      if (toolRounds > maxToolRounds) {
        return {
          error: "OpenRouter tool call loop exceeded limit.",
          errorType: "TIMEOUT",
        };
      }

      const normalizedToolCalls = toolCalls.map((toolCall, index) => ({
        ...toolCall,
        id: toolCall.id ?? `tool_call_${toolRounds}_${index}`,
      }));

      messages.push({
        role: "assistant",
        content: typeof message.content === "string" ? message.content : null,
        tool_calls: normalizedToolCalls,
      });

      for (const toolCall of normalizedToolCalls) {
        const functionName = toolCall.function?.name;
        const rawArgs = toolCall.function?.arguments ?? "";

        let toolResult: import("@/types/tool/interfaces").ToolResult | undefined;
        let parsedArgs: Record<string, unknown> = {};

        if (!functionName) {
          toolResult = buildToolErrorResult("Tool call missing function name");
        } else {
          if (rawArgs) {
            try {
              parsedArgs = JSON.parse(rawArgs);
            } catch (parseError) {
              log.warn(`OpenRouter tool call args parse failed for ${functionName}: ${rawArgs}`, parseError as Error);
              toolResult = buildToolErrorResult(`Invalid tool arguments for ${functionName}`);
            }
          }

          if (!toolResult) {
            log.info(`Executing OpenRouter tool call: ${functionName} with args: ${JSON.stringify(parsedArgs)}`);
            toolResult = await executeTool(functionName, parsedArgs, toolContext);
          }
        }

        const convertedResult = openrouterAdapter.convertResult(
          toolResult ?? buildToolErrorResult("Tool execution failed"),
        );
        const resultContent =
          typeof convertedResult.content === "string"
            ? convertedResult.content
            : JSON.stringify(convertedResult.content);
        const toolCallId = toolCall.id ?? "tool_call_unknown";

        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: resultContent,
        });
      }

      continue;
    }

    const responseText = extractResponseText(message.content);
    if (!responseText || responseText.trim() === "") {
      return {
        error: "OpenRouter returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    let parsedResponse: {
      attribute_list?: string[];
      sample_dialogues_in?: string[];
      sample_dialogues_out?: string[];
    };

    try {
      parsedResponse = JSON.parse(responseText);
    } catch (parseError) {
      log.error("OpenRouter preset generation JSON parse failed", parseError as Error);
      return {
        error: "Invalid JSON response from OpenRouter.",
        errorType: "INVALID_JSON",
      };
    }

    if (!parsedResponse.attribute_list || !parsedResponse.sample_dialogues_in || !parsedResponse.sample_dialogues_out) {
      return {
        error: "Generated character data is incomplete. Please try again.",
        errorType: "INVALID_JSON",
      };
    }

    if (!Array.isArray(parsedResponse.attribute_list) || parsedResponse.attribute_list.length !== 6) {
      return {
        error: "Generated attribute list must contain exactly 6 items. Please try again.",
        errorType: "VALIDATION_ERROR",
      };
    }

    if (!Array.isArray(parsedResponse.sample_dialogues_in) || parsedResponse.sample_dialogues_in.length !== 5) {
      return {
        error: "Generated sample dialogues must contain exactly 5 user inputs.",
        errorType: "VALIDATION_ERROR",
      };
    }

    if (!Array.isArray(parsedResponse.sample_dialogues_out) || parsedResponse.sample_dialogues_out.length !== 5) {
      return {
        error: "Generated sample dialogues must contain exactly 5 character responses.",
        errorType: "VALIDATION_ERROR",
      };
    }

    const sanitizedDialoguesIn = parsedResponse.sample_dialogues_in.map(sanitizeSampleDialogueText);
    const sanitizedDialoguesOut = parsedResponse.sample_dialogues_out.map(sanitizeSampleDialogueText);

    const preset = {
      tomori_nickname: params.characterName,
      trigger_words: [params.characterName],
      attribute_list: parsedResponse.attribute_list,
      sample_dialogues_in: sanitizedDialoguesIn,
      sample_dialogues_out: sanitizedDialoguesOut,
    };

    log.success(`OpenRouter preset generation successful for ${params.characterName}`);
    return { preset };
  }
}
