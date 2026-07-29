/**
 * AI-Powered Preset Generation for the Z.ai provider (shared with Zaicoding).
 *
 * Uses json_object response mode with the preset schema injected into
 * the system prompt (Z.ai uses prompt-steered JSON output, similar to
 * DeepSeek). Includes a full tool-calling loop for models with web-search
 * tools enabled (has_tools=true).
 *
 * Both the endpoint URL and tool adapter are configurable so this generator
 * can be reused by both the Z.ai and Zaicoding providers.
 */
import { log } from "@/utils/misc/logger";
import { executeTool } from "@/tools/toolRegistry";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import type { GeneratePresetParams, PresetGenerationResult } from "@/types/provider/featureInterfaces";
import type { OpenAICompatibleToolAdapter } from "@/providers/openaiCompatible/openaiCompatibleToolAdapter";
import { getZaiToolAdapter } from "@/providers/zai/zaiToolAdapter";
import { sanitizeSampleDialogueText } from "@/providers/google/presetGenerator";
import { toZaiApiModelName, ZAI_GENERAL_CHAT_COMPLETIONS_URL, ZAI_REASONING_MODELS } from "@/providers/zai/zaiShared";
import {
  buildPresetResponseSchema,
  buildPresetPrompt,
  buildToolErrorResult,
  type PresetMessage,
  type PresetToolCall,
} from "@/providers/utils/presetCommon";

/** Options for Z.ai preset generation. */
interface ZaiPresetGenerationOptions {
  model: string;
  temperature?: number;
  tools?: Array<Record<string, unknown>>;
  toolContext?: ToolContext;
  maxToolRounds?: number;
  /** Override endpoint URL — used by Zaicoding to point to its coding endpoint. */
  endpointUrl?: string;
  /** Override tool adapter — used by Zaicoding to supply its own adapter. */
  toolAdapter?: OpenAICompatibleToolAdapter;
}

/**
 * Build a system prompt that steers the model toward the preset JSON schema.
 * Z.ai uses prompt-steered json_object mode (no native json_schema support).
 */
function buildZaiPresetSystemPrompt(): string {
  const schema = buildPresetResponseSchema();
  return [
    "You are a JSON-only character preset generator.",
    "Return a valid json object only.",
    "The word json is intentional and required.",
    "Target json schema for preset_export_data:",
    JSON.stringify(schema, null, 2),
    "Do not wrap the json in markdown fences and do not add extra prose.",
  ].join("\n\n");
}

/**
 * Generate preset data from user prompts using the Z.ai API.
 *
 * @param _locale - User's locale (reserved for future error localisation)
 * @param options - Z.ai-specific options (model, tools, temperature, endpointUrl, toolAdapter)
 * @returns Generated preset or a typed error result
 */
export async function generatePresetFromPromptZai(
  apiKey: string,
  params: GeneratePresetParams,
  _locale: string,
  options: ZaiPresetGenerationOptions,
): Promise<PresetGenerationResult> {
  if (!apiKey || apiKey.trim().length < 10) {
    return { error: "Invalid Z.ai API key", errorType: "API_KEY" };
  }

  const apiModel = toZaiApiModelName(options.model);
  const toolAdapter = options.toolAdapter ?? getZaiToolAdapter();
  const endpointUrl = options.endpointUrl ?? ZAI_GENERAL_CHAT_COMPLETIONS_URL;
  const tools = options.tools ?? [];
  const toolContext = options.toolContext;
  const toolsEnabled = tools.length > 0 && toolContext;

  const messages: PresetMessage[] = [
    { role: "system", content: buildZaiPresetSystemPrompt() },
    { role: "user", content: buildPresetPrompt(params) },
  ];

  const maxToolRounds = options.maxToolRounds ?? 3;
  let toolRounds = 0;

  while (true) {
    const body: Record<string, unknown> = {
      model: apiModel,
      messages,
      max_tokens: 8192,
      response_format: { type: "json_object" },
      stream: false,
    };

    // Skip temperature for reasoning models (they don't support it)
    if (!ZAI_REASONING_MODELS.includes(apiModel)) {
      body.temperature = options.temperature ?? 1.0;
    }

    if (toolsEnabled) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error("Z.ai preset generation request failed", new Error(errorBody), {
        errorType: "ZaiPresetHttpError",
        metadata: {
          model: apiModel,
          status: response.status,
          errorBody,
        },
      });
      return {
        error: `Z.ai request failed (${response.status}): ${response.statusText}`,
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
        error: "Z.ai returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    // Handle tool calls
    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length > 0) {
      if (!toolsEnabled || !toolContext) {
        return {
          error: "Z.ai requested tool calls but tools are not available.",
          errorType: "MODEL_ERROR",
        };
      }

      toolRounds += 1;
      if (toolRounds > maxToolRounds) {
        return {
          error: "Z.ai tool call loop exceeded limit.",
          errorType: "TIMEOUT",
        };
      }

      const normalizedToolCalls = toolCalls.map((tc, idx) => ({
        ...tc,
        id: tc.id ?? `tool_call_${toolRounds}_${idx}`,
      }));

      messages.push({
        role: "assistant",
        content: typeof message.content === "string" ? message.content : null,
        tool_calls: normalizedToolCalls,
      });

      for (const toolCall of normalizedToolCalls) {
        const functionName = toolCall.function?.name;
        const rawArgs = toolCall.function?.arguments ?? "";
        let toolResult: ToolResult | undefined;
        let parsedArgs: Record<string, unknown> = {};

        if (!functionName) {
          toolResult = buildToolErrorResult("Tool call missing function name");
        } else {
          if (rawArgs) {
            try {
              parsedArgs = JSON.parse(rawArgs);
            } catch (parseError) {
              log.warn(`Z.ai tool call args parse failed for ${functionName}: ${rawArgs}`, parseError as Error);
              toolResult = buildToolErrorResult(`Invalid tool arguments for ${functionName}`);
            }
          }

          if (!toolResult) {
            log.info(`Executing Z.ai preset tool call: ${functionName} with args: ${JSON.stringify(parsedArgs)}`);
            toolResult = await executeTool(functionName, parsedArgs, toolContext);
          }
        }

        const convertedResult = toolAdapter.convertResult(toolResult ?? buildToolErrorResult("Tool execution failed"));
        const resultContent =
          typeof convertedResult.content === "string"
            ? convertedResult.content
            : JSON.stringify(convertedResult.content);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id ?? "tool_call_unknown",
          content: resultContent,
        });
      }

      continue;
    }

    const responseText = typeof message.content === "string" ? message.content.trim() : "";
    if (!responseText) {
      return {
        error: "Z.ai returned an empty response.",
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
      log.error("Z.ai preset generation JSON parse failed", parseError as Error);
      return {
        error: "Invalid JSON response from Z.ai.",
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

    log.success(`Z.ai preset generation successful for ${params.characterName}`);
    return { preset };
  }
}
