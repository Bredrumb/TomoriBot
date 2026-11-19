import { OpenAICompatibleToolAdapter } from "@/providers/openaiCompatible/openaiCompatibleToolAdapter";
import { type ToolStateForContext, getAvailableToolsWithMCP } from "@/tools/toolRegistry";
import { applyStreamContextAvailability } from "@/tools/availability";
import { getToolSpriteRoster } from "@/tools/spriteSelection";
import { log } from "@/utils/misc/logger";
import { shouldInjectVerbatimToolCallingNudge } from "@/utils/tools/verbatimToolCalling";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { TomoriState } from "@/types/db/schema";

// Kept terse without full calling-format instructions because the accompanying verbatim nudge near the dialogue tail
// already provides them.
const VERBATIM_TOOL_DEFINITIONS_HEADER =
  'The following tools are available to you in verbatim tool-calling mode. These are the only callable tools, shown with their exact JSON parameter schemas. To use one, output a single verbatim tool call as described in your tool-calling instructions, for example: `tool_name({"arg":"value"})`.';

async function buildVerbatimToolDefinitionsJson(
  tomoriState: TomoriState,
  contextItems: StructuredContextItem[],
  isUserImpersonation: boolean,
  userId?: number,
): Promise<Array<Record<string, unknown>>> {
  const provider = tomoriState.llm.llm_provider;
  const toolStateForContext: ToolStateForContext = {
    server_id: tomoriState.server_id.toString(),
    speechToolState: { userId },
    activePersonaHasElevenlabsVoice: Boolean(
      tomoriState.speech_voice_sample_id ||
        tomoriState.speech_voice_design_prompt?.trim() ||
        tomoriState.speech_voice_id?.trim(),
    ),
    activePersonaVoiceDesignPrompt: tomoriState.speech_voice_design_prompt?.trim() || null,
    activePersonaVoiceSampleId: tomoriState.speech_voice_sample_id,
    activePersonaVoiceId: tomoriState.speech_voice_id,
    activePersonaVoiceSourcePriority: tomoriState.voice_source_priority,

    llm: {
      llm_codename: tomoriState.llm.llm_codename,
      has_tools: tomoriState.llm.has_tools,
      sees_images: tomoriState.llm.sees_images,
      sees_videos: tomoriState.llm.sees_videos,
      sees_youtube: tomoriState.llm.sees_youtube,
      supports_structoutput: tomoriState.llm.supports_structoutput,
    },
    diffusion_model_id: tomoriState.config.diffusion_model_id,
    nai_diffusion_model_id: tomoriState.config.nai_diffusion_model_id,
    video_model_id: tomoriState.config.video_model_id,
    config: {
      emoji_usage_enabled: tomoriState.config.emoji_usage_enabled,
      sticker_usage_enabled: tomoriState.config.sticker_usage_enabled,
      web_search_enabled: tomoriState.config.web_search_enabled,
      self_teaching_enabled: tomoriState.config.self_teaching_enabled,
      manage_message_enabled: tomoriState.config.manage_message_enabled,
      imagegen_enabled: tomoriState.config.imagegen_enabled,
      videogen_enabled: tomoriState.config.videogen_enabled,
      voice_message_enabled: tomoriState.config.voice_message_enabled,
      user_blocking_enabled: tomoriState.config.user_blocking_enabled,
      user_info_updates_enabled: tomoriState.config.user_info_updates_enabled,
      thread_creation_enabled: tomoriState.config.thread_creation_enabled,
      conditioning_interactions_enabled: tomoriState.config.conditioning_interactions_enabled,
      dice_rolling_enabled: tomoriState.config.dice_rolling_enabled,
      danbooru_enabled: tomoriState.config.danbooru_enabled,
    },
  };

  const { builtInTools, mcpFunctionNames } = await getAvailableToolsWithMCP(provider, toolStateForContext);

  // Uses OpenAI-compatible schemas for all providers because verbatim mode expects uniform JSON parameter definitions.
  const adapter = new OpenAICompatibleToolAdapter(provider);
  return adapter.getAllToolsInProviderFormat(
    applyStreamContextAvailability({
      providerLabel: provider,
      provider,
      builtInTools,
      tomoriState,
      streamContext: {
        disableYouTubeProcessing: false,
        personaSprites: getToolSpriteRoster(contextItems, tomoriState.persona_id),
        deliveryMode: isUserImpersonation ? "user_impersonation" : "persona",
      },
    }),
    tomoriState.server_id,
    mcpFunctionNames,
  );
}

// Tool schemas are serialized in-band under the verbatim-nudge gate so endpoints that ignore the native tools field
// still receive them with the nudge.
export async function buildVerbatimToolDefinitionsContextItem(params: {
  tomoriState: TomoriState | null | undefined;
  userId?: number;
  contextItems: StructuredContextItem[];
  isUserImpersonation: boolean;
}): Promise<StructuredContextItem | null> {
  try {
    const { tomoriState } = params;
    if (!shouldInjectVerbatimToolCallingNudge(tomoriState) || !tomoriState) {
      return null;
    }

    const tools = await buildVerbatimToolDefinitionsJson(
      tomoriState,
      params.contextItems,
      params.isUserImpersonation,
      params.userId,
    );
    if (tools.length === 0) {
      return null;
    }

    const toolsJson = JSON.stringify(tools, null, 2);
    const text = `${VERBATIM_TOOL_DEFINITIONS_HEADER}\n\nAvailable tools (JSON):\n\`\`\`json\n${toolsJson}\n\`\`\``;

    return {
      role: "user",
      parts: [{ type: "text", text }],
      metadataTag: ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS,
    };
  } catch (error) {
    log.warn("Failed to add verbatim tool definitions context", error);
    return null;
  }
}
