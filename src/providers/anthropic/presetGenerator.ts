/**
 * AI-Powered Preset Generation for the Anthropic provider.
 *
 * Uses the forced tool-use pattern for structured output, where a single
 * tool whose input_schema matches the preset response schema is defined and
 * the model is forced to call it via tool_choice.
 *
 * Includes a tool-calling loop for models with web-search tools enabled.
 */

import { log } from "@/utils/misc/logger";
import { executeTool } from "@/tools/toolRegistry";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import type { GeneratePresetParams, PresetGenerationResult } from "@/types/provider/featureInterfaces";
import { getAnthropicToolAdapter } from "@/providers/anthropic/anthropicToolAdapter";
import { sanitizeSampleDialogueText } from "@/providers/google/presetGenerator";
import { buildPresetResponseSchema, buildPresetPrompt, buildToolErrorResult } from "@/providers/utils/presetCommon";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

/** Options for Anthropic preset generation. */
interface AnthropicPresetGenerationOptions {
  model: string;
  temperature?: number;
  tools?: Array<Record<string, unknown>>;
  toolContext?: ToolContext;
  maxToolRounds?: number;
}

/**
 * Build the system prompt for Anthropic preset generation.
 * Injects the response schema so the model knows the expected output shape.
 */
function buildAnthropicPresetSystemPrompt(): string {
  const schema = buildPresetResponseSchema();
  return [
    "You are a JSON-only character preset generator.",
    "Return a valid json object only.",
    "Target json schema for preset_export_data:",
    JSON.stringify(schema, null, 2),
    "Do not wrap the json in markdown fences and do not add extra prose.",
  ].join("\n\n");
}

/**
 * Anthropic tool call format from streaming response
 */
interface AnthropicToolCallBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Generate preset data from user prompts using the Anthropic Messages API.
 */
export async function generatePresetFromPromptAnthropic(
  apiKey: string,
  params: GeneratePresetParams,
  _locale: string,
  options: AnthropicPresetGenerationOptions,
): Promise<PresetGenerationResult> {
  if (!apiKey || apiKey.trim().length < 10) {
    return { error: "Invalid Anthropic API key", errorType: "API_KEY" };
  }

  const anthropicAdapter = getAnthropicToolAdapter();
  const tools = options.tools ?? [];
  const toolContext = options.toolContext;
  const toolsEnabled = tools.length > 0 && toolContext;

  // Build the preset tool definition (forced tool use for structured output)
  const presetToolDef = {
    name: "preset_export_data",
    description: "Generate structured character preset data",
    input_schema: buildPresetResponseSchema(),
  };

  // Build initial messages
  const messages: Array<Record<string, unknown>> = [{ role: "user", content: buildPresetPrompt(params) }];

  // Build tools list: preset schema tool + any search tools
  const allTools: Array<Record<string, unknown>> = [presetToolDef];
  if (toolsEnabled) {
    allTools.push(...tools);
  }

  const maxToolRounds = options.maxToolRounds ?? 3;
  let toolRounds = 0;

  while (true) {
    // Build request body
    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: 8192,
      system: buildAnthropicPresetSystemPrompt(),
      messages,
      tools: allTools,
      stream: false,
      temperature: options.temperature ?? 1.0,
    };

    // Send the request
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error("Anthropic preset generation request failed", new Error(errorBody), {
        errorType: "AnthropicPresetHttpError",
        metadata: {
          model: options.model,
          status: response.status,
          errorBody,
        },
      });
      return {
        error: `Anthropic request failed (${response.status}): ${response.statusText}`,
        errorType: "CONNECTION",
      };
    }

    const result = (await response.json()) as {
      content?: Array<Record<string, unknown>>;
      stop_reason?: string;
    };

    if (!result.content || result.content.length === 0) {
      return {
        error: "Anthropic returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    // Check for tool_use blocks
    const toolUseBlocks = result.content.filter(
      (block) => block.type === "tool_use",
    ) as unknown as AnthropicToolCallBlock[];

    const textBlocks = result.content.filter((block) => block.type === "text");

    // Handle tool calls (search tools, not the preset schema tool)
    const searchToolCalls = toolUseBlocks.filter((tc) => tc.name !== "preset_export_data");

    if (searchToolCalls.length > 0) {
      if (!toolsEnabled || !toolContext) {
        return {
          error: "Anthropic requested tool calls but tools are not available.",
          errorType: "MODEL_ERROR",
        };
      }

      toolRounds += 1;
      if (toolRounds > maxToolRounds) {
        return {
          error: "Anthropic tool call loop exceeded limit.",
          errorType: "TIMEOUT",
        };
      }

      // Add assistant message with all content blocks
      messages.push({
        role: "assistant",
        content: result.content,
      });

      // Build user message with tool results
      const toolResultBlocks: Array<Record<string, unknown>> = [];

      for (const toolCall of searchToolCalls) {
        const functionName = toolCall.name;
        const toolArgs = toolCall.input;

        log.info(`Executing Anthropic preset tool call: ${functionName} with args: ${JSON.stringify(toolArgs)}`);

        let toolResult: ToolResult | undefined;
        try {
          toolResult = await executeTool(functionName, toolArgs, toolContext);
        } catch (execErr) {
          log.warn(`Anthropic tool call execution failed: ${functionName}`, execErr as Error);
          toolResult = buildToolErrorResult(
            `Tool execution failed: ${execErr instanceof Error ? execErr.message : String(execErr)}`,
          );
        }

        const convertedResult = anthropicAdapter.convertResult(
          toolResult ?? buildToolErrorResult("Tool execution failed"),
        );

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content:
            typeof convertedResult.content === "string"
              ? convertedResult.content
              : JSON.stringify(convertedResult.content),
        });
      }

      messages.push({
        role: "user",
        content: toolResultBlocks,
      });

      continue;
    }

    // Check for the preset_export_data tool call (structured output)
    const presetToolCall = toolUseBlocks.find((tc) => tc.name === "preset_export_data");

    if (presetToolCall) {
      const parsedResponse = presetToolCall.input as {
        attribute_list?: string[];
        sample_dialogues_in?: string[];
        sample_dialogues_out?: string[];
      };

      if (
        !parsedResponse.attribute_list ||
        !parsedResponse.sample_dialogues_in ||
        !parsedResponse.sample_dialogues_out
      ) {
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

      log.success(`Anthropic preset generation successful for ${params.characterName}`);
      return { preset };
    }

    // If no tool_use blocks, try to parse text content as JSON (fallback)
    const responseText = textBlocks
      .map((b) => (b as { text?: string }).text ?? "")
      .join("")
      .trim();

    if (!responseText) {
      return {
        error: "Anthropic returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    try {
      const parsedResponse = JSON.parse(responseText) as {
        attribute_list?: string[];
        sample_dialogues_in?: string[];
        sample_dialogues_out?: string[];
      };

      if (
        !parsedResponse.attribute_list ||
        !parsedResponse.sample_dialogues_in ||
        !parsedResponse.sample_dialogues_out
      ) {
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

      log.success(`Anthropic preset generation successful (text fallback) for ${params.characterName}`);
      return { preset };
    } catch (parseError) {
      log.error("Anthropic preset generation JSON parse failed", parseError as Error);
      return {
        error: "Invalid JSON response from Anthropic.",
        errorType: "INVALID_JSON",
      };
    }
  }
}
