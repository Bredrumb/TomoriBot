import { resolveEffectiveOpenRouterSeesYouTube } from "@/utils/provider/openrouterModelCapabilities";
import { isPromptSystemItem } from "@/utils/text/context/promptLayout";
import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";
import type { PreparedNovelAIRequest } from "@/providers/novelai/promptFitting";
import { convertToOpenAIParams, usesOpenAIEndpoint } from "@/providers/novelai/novelaiService";
import type { TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { AnthropicStreamAdapter } from "@/providers/anthropic/anthropicStreamAdapter";
import { GoogleStreamAdapter } from "@/providers/google/googleStreamAdapter";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { VertexStreamAdapter } from "@/providers/vertex/vertexStreamAdapter";
import { VertexexpressStreamAdapter } from "@/providers/vertexexpress/vertexexpressStreamAdapter";
import { buildProviderStopStrings } from "@/providers/utils/stopStrings";
import { getStaticProviderInfo, normalizeProviderName } from "@/utils/provider/providerInfoRegistry";
import { buildActiveSamplingParams, selectAnthropicSamplingParams } from "@/utils/provider/samplingControl";
import {
  buildAnthropicThinkingRequest,
  buildCustomThinkingRequest,
  buildDeepSeekThinkingRequest,
  buildGoogleThinkingConfig,
  buildOpenRouterReasoningRequest,
  buildZaiThinkingRequest,
  getNovelAiThinkingDirective,
  serializeGoogleThinkingConfig,
} from "@/utils/provider/thinkingControl";

type TagLabel = {
  title: string;
  // Expected format: slash-command reference such as `/memories`, or the literal "system-managed".
  hint: string;
  subsections?: Array<{ title: string; hint: string }>;
};

const TAG_LABELS: Readonly<Record<ContextItemTag, TagLabel>> = {
  [ContextItemTag.SYSTEM_INSTRUCTION_BLOCK]: { title: "System Instruction Block", hint: "system-managed" },
  [ContextItemTag.SYSTEM_PERSONALITY]: {
    title: "Persona Attributes",
    hint: "/config > Persona > Identity & Personality",
  },
  [ContextItemTag.SYSTEM_HUMANIZER_RULES]: { title: "System Prompt", hint: "/config > Behavior > General Behavior" },
  [ContextItemTag.SYSTEM_CHANNEL_PROMPT]: { title: "Channel Prompt", hint: "/config > Channels > Channel Overrides" },
  [ContextItemTag.SYSTEM_PERSONA_PROMPT]: { title: "Persona Prompt", hint: "/config > Persona > Advanced" },
  [ContextItemTag.SYSTEM_FUNCTION_GUIDE]: { title: "Function Guide", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_SERVER_INFO]: { title: "Discord Server Info", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_SERVER_EMOJIS]: { title: "Server Emojis", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_SERVER_STICKERS]: { title: "Server Stickers", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_PERSONA_SPRITES]: { title: "Persona Sprites", hint: "/config > Persona > Sprites" },
  [ContextItemTag.KNOWLEDGE_SERVER_MEMORIES]: { title: "Server Memories", hint: "/memories" },
  [ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS]: { title: "Server Documents", hint: "/memories" },
  [ContextItemTag.KNOWLEDGE_RECALLED_MEMORIES]: { title: "Recalled Memories", hint: "/memories, /personal memories" },
  [ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE]: { title: "Lorebook (Before)", hint: "/memories" },
  [ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER]: { title: "Lorebook (After)", hint: "/memories" },
  [ContextItemTag.KNOWLEDGE_SERVER_CONDITIONING]: { title: "Conditioning Log", hint: "/conditioning" },
  [ContextItemTag.KNOWLEDGE_PERSONA_USER_BLOCKS]: { title: "Persona-User Blocks", hint: "/moderation" },
  [ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS]: { title: "Tool Definitions", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_USER_MEMORIES]: { title: "Personal Memories", hint: "/personal memories" },
  [ContextItemTag.KNOWLEDGE_USER_STATUS]: { title: "Discord Presence", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_CURRENT_CONTEXT]: { title: "Current Context", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION]: {
    title: "Info on Users in Context",
    hint: "composite",
    subsections: [
      { title: "Personal/Server Memories", hint: "/memories, /personal memories" },
      { title: "Other Personas' Public Attributes", hint: "/config > Persona > Identity & Personality" },
    ],
  },
  [ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY]: { title: "Short-Term Memory", hint: "/memories" },
  [ContextItemTag.DIALOGUE_SAMPLE]: { title: "Sample Dialogue", hint: "/config > Persona > Identity & Personality" },
  [ContextItemTag.DIALOGUE_HISTORY]: { title: "Conversation History", hint: "system-managed" },
  [ContextItemTag.CONTEXT_NOTE_INJECTION]: {
    title: "Context Note",
    hint: "/config > Behavior > General Behavior, /config > Channels > Channel Overrides",
  },
};

function renderTagHeader(tag: ContextItemTag | undefined): string {
  if (!tag) return "=== Untagged (system-managed) ===";
  const label = TAG_LABELS[tag];

  const lines: string[] = [];
  if (label.hint === "composite") {
    lines.push(`=== ${label.title} ===`);
  } else if (label.hint === "system-managed") {
    lines.push(`=== ${label.title} (system-managed) ===`);
  } else {
    lines.push(`=== ${label.title} (\`${label.hint}\`) ===`);
  }
  if (label.subsections) {
    for (const sub of label.subsections) {
      if (sub.hint === "system-managed") {
        lines.push(`== ${sub.title} (system-managed) ==`);
      } else {
        lines.push(`== ${sub.title} (\`${sub.hint}\`) ==`);
      }
    }
  }
  return lines.join("\n");
}

export function buildTextSnapshot(
  contextItems: StructuredContextItem[],
  requestConfig: Record<string, unknown>,
  snapshotInfo: string[],
  novelaiRequest?: PreparedNovelAIRequest,
): string {
  const lines: string[] = [
    "=== Snapshot Info (annotation, NOT part of the prompt) ===",
    ...snapshotInfo,
    "",
    "=== Request Config (annotation, NOT part of the prompt) ===",
    JSON.stringify(requestConfig, null, 2),
    "",
  ];

  if (novelaiRequest) {
    lines.push(
      novelaiRequest.prompt,
      "",
      "=== Fitting Report (annotation, NOT part of the prompt) ===",
      JSON.stringify(novelaiRequest.report, null, 2),
    );
    return lines.join("\n");
  }

  for (const item of contextItems) {
    lines.push(renderTagHeader(item.metadataTag));

    for (const part of item.parts) {
      if (part.type === "text") {
        lines.push(part.text);
      } else if (part.type === "image") {
        const byteEstimate = part.uri.startsWith("data:")
          ? Math.round(((part.uri.length - part.uri.indexOf(",") - 1) * 3) / 4)
          : 0;
        const sizeLabel = byteEstimate > 0 ? `~${byteEstimate} bytes` : "URL";
        lines.push(`[IMAGE: ${part.mimeType}, ${sizeLabel}, hidden]`);
      } else if (part.type === "video") {
        const ytSuffix = part.isYouTubeLink ? ", YouTube" : "";
        lines.push(`[VIDEO: ${part.mimeType}${ytSuffix}, hidden]`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

// Snapshot metadata is omitted and base64 image data is redacted so the payload stays compact and shaped like a
// provider request.
export async function buildJsonSnapshot(
  contextItems: StructuredContextItem[],
  persona: TomoriState,
  providerName: string,
  modelName: string,
  toolsData: Array<Record<string, unknown>> | null,
  requestConfig: Record<string, unknown>,
  novelaiRequest?: PreparedNovelAIRequest,
): Promise<Record<string, unknown>> {
  if (novelaiRequest) {
    const stops = novelaiRequest.stopStrings;
    return {
      ...(usesOpenAIEndpoint(modelName)
        ? {
            model: modelName,
            prompt: novelaiRequest.prompt,
            ...convertToOpenAIParams(novelaiRequest.parameters, stops),
            stream: true,
          }
        : {
            input: novelaiRequest.prompt,
            model: modelName,
            parameters: novelaiRequest.parameters,
            openAIStopStrings: stops,
          }),
      fitting: novelaiRequest.report,
    };
  }
  const activeLlm = persona.persona_llm ?? persona.llm;
  const seesImages = activeLlm.sees_images;
  const seesVideos = activeLlm.sees_videos;

  let requestData: Record<string, unknown>;
  const providerInfo = getStaticProviderInfo(providerName);
  const providerKey = providerInfo?.name ?? normalizeProviderName(providerName);
  const providerFamily = providerInfo?.apiFamily ?? "openai-compatible";
  const googleSnapshotAdapterFactories: Record<
    string,
    () => GoogleStreamAdapter | VertexStreamAdapter | VertexexpressStreamAdapter
  > = {
    google: () => new GoogleStreamAdapter(),
    vertex: () => new VertexStreamAdapter(),
    vertexexpress: () => new VertexexpressStreamAdapter(),
  };
  const googleSnapshotAdapterFactory = googleSnapshotAdapterFactories[providerKey];

  if (googleSnapshotAdapterFactory) {
    const adapter = googleSnapshotAdapterFactory();
    const payload = await adapter.buildTokenCountPayload(contextItems, modelName);

    const sanitizedContents = payload.contents.map((content) => ({
      ...content,
      // biome-ignore lint/suspicious/noExplicitAny: Google Part type lacks index signature; cast needed for sanitization
      parts: ((content.parts ?? []) as Array<any>).map((part: Record<string, unknown>) => {
        if ("inlineData" in part && part.inlineData) {
          const inlineData = part.inlineData as Record<string, unknown>;
          return { inlineData: { mimeType: inlineData.mimeType, data: "[BASE64_HIDDEN]" } };
        }
        return part;
      }),
    }));

    requestData = {
      model: modelName,
      systemInstruction: payload.systemInstruction,
      contents: sanitizedContents,
    };
  } else if (providerFamily === "openrouter" || providerFamily === "openai-compatible") {
    const adapter = new OpenrouterStreamAdapter();
    const messages = await adapter.buildProbeMessages(
      contextItems,
      seesImages,
      seesVideos,
      resolveEffectiveOpenRouterSeesYouTube({ ...persona, llm: activeLlm }),
    );

    const sanitized = messages.map((msg: Record<string, unknown>) => {
      if (!Array.isArray(msg.content)) return msg;
      return {
        ...msg,
        content: (msg.content as Array<Record<string, unknown>>).map((part) => {
          if (part.type === "image_url") {
            const imageUrl = (part as { image_url?: { url?: string } }).image_url;
            if (imageUrl?.url?.startsWith("data:")) {
              return { type: "image_url", image_url: { ...imageUrl, url: "[BASE64_HIDDEN]" } };
            }
          }
          return part;
        }),
      };
    });

    requestData = { model: modelName, messages: sanitized };
  } else if (providerFamily === "anthropic") {
    const adapter = new AnthropicStreamAdapter();
    const { system, messages } = await adapter.buildProbeMessages(contextItems, seesImages);

    const sanitizedMessages = messages.map((msg: Record<string, unknown>) => {
      const content = msg.content;
      if (typeof content === "string") return msg;
      const sanitizedContent = (content as Array<Record<string, unknown>>).map((block) => {
        if (
          block.type === "image" &&
          block.source &&
          typeof (block.source as Record<string, unknown>).data === "string"
        ) {
          return { ...block, source: { ...(block.source as Record<string, unknown>), data: "[BASE64_HIDDEN]" } };
        }
        return block;
      });
      return { ...msg, content: sanitizedContent };
    });

    requestData = { model: modelName, system, messages: sanitizedMessages };
  } else {
    // Flatten system blocks into one leading entry because OpenAI-compatible endpoints reject or drop extra system
    // messages.
    const systemTextChunks: string[] = [];
    const nonSystemItems: StructuredContextItem[] = [];
    for (const item of contextItems) {
      if (isPromptSystemItem(item)) {
        const text = item.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        if (text.trim()) systemTextChunks.push(text);
      } else {
        nonSystemItems.push(item);
      }
    }

    const messagesList: Array<Record<string, unknown>> = [];
    if (systemTextChunks.length > 0) {
      messagesList.push({ role: "system", content: systemTextChunks.join("\n\n") });
    }

    for (const item of nonSystemItems) {
      const role = item.role === "model" ? "assistant" : item.role;
      const hasMedia = item.parts.some((p) => p.type !== "text");

      if (!hasMedia) {
        const text = item.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        messagesList.push({ role, content: text });
        continue;
      }

      const content = item.parts.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "image") {
          return { type: "image_url", image_url: { url: "[MEDIA_HIDDEN]" }, mime_type: part.mimeType };
        }
        return {
          type: "video_url",
          video_url: { url: "[MEDIA_HIDDEN]" },
          mime_type: part.mimeType,
          ...(part.isYouTubeLink ? { youtube: true } : {}),
        };
      });
      messagesList.push({ role, content });
    }

    requestData = { model: modelName, messages: messagesList };
  }

  // Put non-colliding requestConfig keys right after model so adapter keys win and config precedes long message
  // arrays.
  const { model, ...payload } = requestData;
  const config = Object.fromEntries(Object.entries(requestConfig).filter(([key]) => !(key in requestData)));

  // Include provider-formatted tools even when empty because per-turn filtering can suppress all tools.
  return { model, ...config, ...payload, ...(toolsData ? { tools: toolsData } : {}) };
}

// OpenRouter supportedParameters are not probed here, so parameters a model may reject at runtime still appear in the
// snapshot.
export function buildRequestConfig(
  persona: TomoriState,
  providerName: string,
  modelName: string,
  maxOutputTokens: number | undefined,
  novelaiRequest?: PreparedNovelAIRequest,
): Record<string, unknown> {
  if (novelaiRequest) {
    return usesOpenAIEndpoint(modelName)
      ? { ...convertToOpenAIParams(novelaiRequest.parameters, novelaiRequest.stopStrings) }
      : { ...novelaiRequest.parameters };
  }
  const activeLlm = persona.persona_llm ?? persona.llm;
  const config = persona.config;
  const disabledParams = config.llm_disabled_params ?? [];
  const providerInfo = getStaticProviderInfo(providerName);
  const providerKey = providerInfo?.name ?? normalizeProviderName(providerName);
  const providerFamily = providerInfo?.apiFamily ?? "openai-compatible";
  const supportsParam = (param: string) =>
    providerInfo?.supportedParams.some((supportedParam) => supportedParam === param) ?? true;

  if (providerFamily === "google-genai") {
    // Google/Vertex keeps raw configured values in generation_config because live adapters skip disabledParams there.
    const out: Record<string, unknown> = {
      generation_config: {
        temperature: config.llm_temperature,
        top_k: config.llm_top_k,
        top_p: config.llm_top_p,
        max_output_tokens: maxOutputTokens,
        stop_sequences: [],
      },
      safety_settings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    };
    const generationConfig = out.generation_config as Record<string, unknown>;
    if (supportsParam("frequencyPenalty")) generationConfig.frequency_penalty = config.llm_frequency_penalty;
    if (supportsParam("presencePenalty")) generationConfig.presence_penalty = config.llm_presence_penalty;
    const thinkingConfig = serializeGoogleThinkingConfig(buildGoogleThinkingConfig(modelName, config.thinking_level));
    if (thinkingConfig) out.thinking_config = thinkingConfig;
    if (disabledParams.length > 0) out.disabled_params = disabledParams;
    return out;
  }

  if (providerFamily === "anthropic") {
    const selection = selectAnthropicSamplingParams({
      temperature: config.llm_temperature,
      topP: config.llm_top_p,
      disabledParams,
    });
    const stopSequences = buildProviderStopStrings({
      providerName: "anthropic",
      model: modelName,
      personaName: persona.persona_nickname,
    });

    const thinkingRequest = buildAnthropicThinkingRequest(modelName, config.thinking_level);
    const out: Record<string, unknown> = { max_tokens: maxOutputTokens };
    if (!thinkingRequest.omitSampling) {
      if (selection.temperature !== undefined) out.temperature = selection.temperature;
      if (selection.topP !== undefined) out.top_p = selection.topP;
      if (config.llm_top_k > 0 && !disabledParams.includes("topK")) out.top_k = config.llm_top_k;
    }
    if (thinkingRequest.thinking) out.thinking = thinkingRequest.thinking;
    if (thinkingRequest.output_config) out.output_config = thinkingRequest.output_config;
    if (stopSequences) out.stop_sequences = stopSequences;
    if (disabledParams.length > 0) out.disabled_params = disabledParams;
    return out;
  }

  const active = buildActiveSamplingParams(config);
  const stopStrings = buildProviderStopStrings({
    providerName,
    model: modelName,
    personaName: persona.persona_nickname,
  });

  const out: Record<string, unknown> = {};
  if (maxOutputTokens !== undefined) out.max_tokens = maxOutputTokens;
  if (active.temperature !== undefined) out.temperature = active.temperature;
  if (active.topP !== undefined) out.top_p = active.topP;
  if (active.topK !== undefined) out.top_k = active.topK;
  if (active.frequencyPenalty !== undefined) out.frequency_penalty = active.frequencyPenalty;
  if (active.presencePenalty !== undefined) out.presence_penalty = active.presencePenalty;
  if (active.minP !== undefined) out.min_p = active.minP;
  if (stopStrings) out.stop = stopStrings;
  if (disabledParams.length > 0) out.disabled_params = disabledParams;

  const requestConfigMutators: Record<string, () => void> = {
    openrouter: () => {
      const reasoningRequest = buildOpenRouterReasoningRequest(config.thinking_level);
      if (reasoningRequest.reasoning) out.reasoning = reasoningRequest.reasoning;
    },
    deepseek: () => {
      const thinkingRequest = buildDeepSeekThinkingRequest(modelName, config.thinking_level);
      if (thinkingRequest.thinking) out.thinking = thinkingRequest.thinking;
      if (thinkingRequest.reasoning_effort) out.reasoning_effort = thinkingRequest.reasoning_effort;
      if (thinkingRequest.omitSampling) {
        delete out.temperature;
        delete out.top_p;
        delete out.frequency_penalty;
        delete out.presence_penalty;
      }
    },
    zai: () => {
      const thinkingRequest = buildZaiThinkingRequest(config.thinking_level);
      if (thinkingRequest.thinking) out.thinking = thinkingRequest.thinking;
      if (thinkingRequest.omitSampling) {
        delete out.temperature;
        delete out.top_p;
        delete out.frequency_penalty;
        delete out.presence_penalty;
      }
    },
    zaicoding: () => {
      const thinkingRequest = buildZaiThinkingRequest(config.thinking_level);
      if (thinkingRequest.thinking) out.thinking = thinkingRequest.thinking;
      if (thinkingRequest.omitSampling) {
        delete out.temperature;
        delete out.top_p;
        delete out.frequency_penalty;
        delete out.presence_penalty;
      }
    },
    custom: () => {
      const customThinking = buildCustomThinkingRequest(config.custom_endpoint_url, config.thinking_level);
      if (customThinking.reasoning_effort) {
        out.reasoning_effort = customThinking.reasoning_effort;
      }
    },
    novelai: () => {
      out.thinking_directive = getNovelAiThinkingDirective(
        config.thinking_level,
        undefined,
        getNovelAIProfile(modelName).thinkingByDefault,
      );
    },
  };
  requestConfigMutators[providerKey]?.();

  // Informational flag only: mirrors activeLlm.has_tools from the adapter runtime.
  if (!activeLlm.has_tools) out.tools_disabled = true;

  return out;
}
