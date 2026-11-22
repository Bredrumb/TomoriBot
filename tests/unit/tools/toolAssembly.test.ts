import { describe, expect, it, mock } from "bun:test";
import { assembleToolsForContext } from "@/tools/assembly";
import { ManageMessageTool } from "@/tools/functionCalls/manageMessageTool";
import { ManageTaskTool } from "@/tools/functionCalls/manageTaskTool";
import { ManageLongTermMemoryTool } from "@/tools/functionCalls/manageLongTermMemoryTool";
import { applyStreamContextAvailability, getAvailableToolsForContext } from "@/tools/availability";
import { ConditioningInteractionTool } from "@/tools/functionCalls/conditioningInteractionTool";
import { CreateThreadTool } from "@/tools/functionCalls/createThreadTool";
import { createPersona } from "../../helpers/fixtures";
import {
  DanbooruGetPostTool,
  DanbooruSearchPostsTool,
  DanbooruSearchTagsTool,
} from "@/tools/functionCalls/danbooruTools";
import { buildGenerateImageToolVariant, GenerateImageTool } from "@/tools/functionCalls/generateImageTool";
import {
  type ImageToolCapabilities,
  resolveCustomEndpointImageCapabilities,
} from "@/tools/functionCalls/generateImageToolCapabilities";
import { buildVoiceMessageToolVariant, GenerateVoiceMessageTool } from "@/tools/functionCalls/generateVoiceMessageTool";
import { buildWebSearchToolVariant, WebSearchTool } from "@/tools/webSearch/webSearchTool";
import type { SearchCategory } from "@/tools/webSearch/types";
import type { Tool, ToolAssemblyContext, ToolAssemblyState, ToolResult } from "@/types/tool/interfaces";
import { customEndpointSchema, type CustomEndpointRow } from "@/types/db/schema";
import * as realSpeechEndpointResolver from "@/utils/provider/speechEndpointResolver";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/provider/speechEndpointResolver": realSpeechEndpointResolver,
});

scopedMock.module("@/utils/provider/speechEndpointResolver", () => ({
  ...realSpeechEndpointResolver,
  resolveSpeechTargets: async () => ({
    design: null,
    clone: {
      endpoint: {
        api_style: "tts-clone",
        endpoint_url: "http://127.0.0.1:8016",
        extra_config: { voice_mode: "clone", script_markup: "plain", supports_instruct: true },
      } as unknown as CustomEndpointRow,
      apiKey: "",
    },
  }),
}));

function createAssemblyState(overrides: Partial<ToolAssemblyState> = {}): ToolAssemblyState {
  return {
    server_id: "1",
    activePersonaHasElevenlabsVoice: true,
    activePersonaVoiceDesignPrompt: null,

    activePersonaVoiceSampleId: 12,
    activePersonaVoiceSourcePriority: "design",
    diffusion_model_id: 1,
    nai_diffusion_model_id: null,
    video_model_id: null,
    llm: {
      llm_codename: "test-model",
      has_tools: true,
      sees_images: true,
      sees_videos: false,
      sees_youtube: false,
      supports_structoutput: true,
    },
    config: {
      emoji_usage_enabled: true,
      sticker_usage_enabled: true,
      web_search_enabled: true,
      self_teaching_enabled: true,
      manage_message_enabled: true,
      imagegen_enabled: true,
      videogen_enabled: true,
      voice_message_enabled: true,
      user_blocking_enabled: true,
      user_info_updates_enabled: true,
      thread_creation_enabled: true,
      conditioning_interactions_enabled: false,
      dice_rolling_enabled: false,
      danbooru_enabled: true,
    },
    ...overrides,
  };
}

function createAssemblyContext(state: ToolAssemblyState = createAssemblyState()): ToolAssemblyContext {
  return {
    provider: "google",
    state,
  };
}

function createStaticTool(): Tool {
  return {
    name: "static_tool",
    description: "Static tool",
    category: "utility",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async (): Promise<ToolResult> => ({ success: true }),
    isAvailableFor: () => true,
  };
}

it("exposes optional sprite selection only for the active persona's advertised roster", () => {
  const persona = createPersona({ persona_id: 7 });
  const voice = buildVoiceMessageToolVariant(new GenerateVoiceMessageTool(), "plain");
  const interaction = new ConditioningInteractionTool();
  const thread = new CreateThreadTool();
  for (const scenario of [
    { personaSprites: undefined, enabled: false },
    { personaSprites: { personaId: 7, spriteKeys: [] }, enabled: false },
    { personaSprites: { personaId: 8, spriteKeys: ["joy"] }, enabled: false },
    { personaSprites: { personaId: 7, spriteKeys: ["joy"] }, enabled: true },
    { personaSprites: { personaId: 7, spriteKeys: ["joy"] }, impersonating: true, enabled: false },
  ]) {
    const tools = applyStreamContextAvailability({
      providerLabel: "fixture",
      provider: "google",
      builtInTools: [voice, interaction, thread],
      tomoriState: persona,
      streamContext: {
        disableYouTubeProcessing: false,
        personaSprites: scenario.personaSprites,
        deliveryMode: scenario.impersonating ? "user_impersonation" : "persona",
      },
    });
    for (const tool of tools.slice(0, 2)) {
      expect(Boolean(tool.parameters.properties.sprite)).toBe(scenario.enabled);
      expect(tool.parameters.required).not.toContain("sprite");
      expect(tool.parameters.properties.sprite?.enum).toBeUndefined();
    }
    expect(tools[2].parameters.properties.sprite).toBeUndefined();
  }
  expect(voice.parameters.properties.sprite).toBeUndefined();
  expect(interaction.parameters.properties.sprite).toBeUndefined();
});

function getEnum(tool: Tool, parameterName: string): string[] {
  const parameter = tool.parameters.properties[parameterName];
  return parameter.enum ?? [];
}

function getPropertyNames(tool: Tool): string[] {
  return Object.keys(tool.parameters.properties).sort();
}

describe("tool schema assembly", () => {
  it("hides message mutations and reactions independently of text replies", () => {
    const tool = new ManageMessageTool();
    const persona = createPersona({ config: { manage_message_enabled: false, emoji_usage_enabled: false } });
    const assemble = (disableRecentMessageReplyTool = false) =>
      applyStreamContextAvailability({
        providerLabel: "fixture",
        provider: "google",
        builtInTools: [tool],
        tomoriState: persona,
        streamContext: { disableYouTubeProcessing: false, disableRecentMessageReplyTool },
      });
    const [replyOnly] = assemble();
    expect(replyOnly).toBeDefined();
    expect(getEnum(replyOnly, "action")).toEqual(["reply"]);
    expect(JSON.stringify({ description: replyOnly.description, parameters: replyOnly.parameters })).not.toMatch(
      /react|emoji|pin|edit|delete/i,
    );
    expect(assemble(true)).toEqual([]);
    expect(getEnum(tool, "action")).toEqual(["pin", "edit", "delete", "reply", "react"]);
  });

  it("offers only the actions selected by saved Deliberate Tool Mode and nudge names", () => {
    const [task, memory, message] = applyStreamContextAvailability({
      providerLabel: "fixture",
      provider: "google",
      builtInTools: [new ManageTaskTool(), new ManageLongTermMemoryTool(), new ManageMessageTool()],
      tomoriState: createPersona({ config: { self_teaching_enabled: true, emoji_usage_enabled: true } }),
      streamContext: {
        disableYouTubeProcessing: false,
        deliberateToolAllowedNames: ["create_task", "update_long_term_memory", "interact_with_recent_message"],
      },
    });
    expect(getEnum(task, "action")).toEqual(["create"]);
    expect(task.parameters.required).toContain("reminder_purpose");
    expect(task.parameters.properties.reminder_id).toBeUndefined();
    expect(getEnum(memory, "action")).toEqual(["update", "delete"]);
    expect(memory.parameters.required).toContain("memory_id");
    expect(getEnum(message, "action")).toEqual(["reply", "react"]);
    expect(message.parameters.properties.end_message_id).toBeUndefined();
  });

  it("leaves tools without an assembly hook unchanged", async () => {
    const tool = createStaticTool();

    const assembledTools = await assembleToolsForContext([tool], createAssemblyContext());

    expect(assembledTools).toHaveLength(1);
    expect(assembledTools[0]).toBe(tool);
  });

  it("assembles web_search with SearXNG categories", () => {
    const tool = buildWebSearchToolVariant(new WebSearchTool(), {
      categories: ["text", "image", "video", "news", "papers", "code", "files", "music"],
      engineLabel: "SearXNG",
    });

    expect(tool).not.toBeNull();
    expect(getEnum(tool as Tool, "category")).toEqual([
      "text",
      "image",
      "video",
      "news",
      "papers",
      "code",
      "files",
      "music",
    ]);
    expect((tool as Tool).description).not.toContain("may be unavailable");
  });

  it("assembles web_search with Brave categories", () => {
    const categories: SearchCategory[] = ["text", "image", "video", "news"];
    const tool = buildWebSearchToolVariant(new WebSearchTool(), {
      categories,
      engineLabel: "Brave Search",
    });

    expect(getEnum(tool as Tool, "category")).toEqual(categories);
  });

  it("assembles web_search with text-only fallback categories", () => {
    const tool = buildWebSearchToolVariant(new WebSearchTool(), {
      categories: ["text"],
      engineLabel: "DuckDuckGo",
    });

    expect(getEnum(tool, "category")).toEqual(["text"]);
    expect(tool.parameters.properties.category.description).toContain("Only 'text'");
  });

  it("assembles generate_image as text-to-image only", () => {
    const capabilities: ImageToolCapabilities = {
      textToImage: true,
      imageToImage: false,
      inpaint: false,
      outpaint: false,
      negativePrompt: false,
      sourceLabel: "Z.ai",
    };

    const tool = buildGenerateImageToolVariant(new GenerateImageTool(), capabilities);

    expect(getPropertyNames(tool as Tool)).toEqual(["aspect_ratio", "nsfw", "prompt"]);
    expect((tool as Tool).description).toContain("text-to-image");
    const promptDescription = (tool as Tool).parameters.properties.prompt.description;
    expect(promptDescription).not.toContain("inpaint");
    expect(promptDescription).not.toContain("outpaint");
  });

  it("assembles generate_image with image-to-image reference fields", () => {
    const capabilities: ImageToolCapabilities = {
      textToImage: true,
      imageToImage: true,
      inpaint: false,
      outpaint: false,
      negativePrompt: false,
      sourceLabel: "Google",
    };

    const tool = buildGenerateImageToolVariant(new GenerateImageTool(), capabilities);

    expect(getPropertyNames(tool as Tool)).toContain("references");
    expect(getPropertyNames(tool as Tool)).not.toContain("media_id");
    expect(getPropertyNames(tool as Tool)).not.toContain("mask_prompt");
    expect(getPropertyNames(tool as Tool)).not.toContain("edit_mode");
    const properties = (tool as Tool).parameters.properties;
    expect(properties.denoise.description).toBe("Img2img strength from 0 to 1. Lower preserves more.");
    expect(properties.prompt.description).toContain("references");
    expect(properties.prompt.description).not.toContain("inpaint");
    expect(properties.prompt.description).not.toContain("outpaint");
  });

  it("assembles generate_image with inpainting and outpainting fields", () => {
    const capabilities: ImageToolCapabilities = {
      textToImage: true,
      imageToImage: true,
      inpaint: true,
      outpaint: true,
      negativePrompt: true,
      sourceLabel: "ComfyUI",
    };

    const tool = buildGenerateImageToolVariant(new GenerateImageTool(), capabilities);
    const propertyNames = getPropertyNames(tool as Tool);

    expect(propertyNames).toContain("mask_prompt");
    expect(propertyNames).toContain("inpaint_preset");
    expect(propertyNames).toContain("edit_mode");
    expect(propertyNames).toContain("outpaint_amount");
    const properties = (tool as Tool).parameters.properties;
    expect(properties.edit_mode).toMatchObject({ type: "string", enum: ["inpaint", "extend", "outpaint"] });
    expect(properties.prompt.description).toContain("For inpaint");
    expect(properties.prompt.description).toContain("For outpaint");
    expect(properties.media_id.description).toContain("inpaint or outpaint");
    expect(properties.denoise.description).toBe("Img2img/inpaint strength from 0 to 1. Lower preserves more.");
  });

  it("advertises only masked modes a custom endpoint can execute", () => {
    const endpoint = customEndpointSchema.parse({
      connection_id: 1,
      custom_endpoint_id: 1,
      server_id: 1,
      capability: "image",
      api_style: "comfyui",
      label: "Fixture workflow",
      endpoint_url: "https://endpoint.invalid",
      requires_auth: false,
      extra_config: { workflow_supports: { txt2img: true, img2img: true, inpaint: true, outpaint: false } },
    });
    const tool = new GenerateImageTool();
    const inpaintOnly = buildGenerateImageToolVariant(tool, resolveCustomEndpointImageCapabilities(endpoint));
    expect(inpaintOnly?.parameters.properties.edit_mode).toMatchObject({
      type: "string",
      enum: ["inpaint", "extend"],
    });
    expect(inpaintOnly?.parameters.properties.outpaint_strategy).toBeUndefined();

    const genericEndpoint = { ...endpoint, api_style: "openai-compatible" as const };
    const generic = buildGenerateImageToolVariant(tool, resolveCustomEndpointImageCapabilities(genericEndpoint));
    expect(generic?.parameters.properties.prompt).toBeDefined();
    expect(generic?.parameters.properties.edit_mode).toBeUndefined();
  });

  it("omits generate_image when no image modes are supported", () => {
    const tool = buildGenerateImageToolVariant(new GenerateImageTool(), {
      textToImage: false,
      imageToImage: false,
      inpaint: false,
      outpaint: false,
      negativePrompt: false,
      sourceLabel: "disabled",
    });

    expect(tool).toBeNull();
  });

  it("assembles generate_voice_message without voice-design fields by default", () => {
    const tool = buildVoiceMessageToolVariant(new GenerateVoiceMessageTool(), "plain");

    expect(getPropertyNames(tool)).toEqual(["script", "title"]);
    expect(tool.parameters.properties.script.description).toContain("Plain text only");
  });

  it("assembles generate_voice_message with voice-design instructions", () => {
    const tool = buildVoiceMessageToolVariant(new GenerateVoiceMessageTool(), "voice-design");

    expect(getPropertyNames(tool)).toEqual(["script", "title", "voice_instructions"]);
    expect(tool.description).toContain("voice design prompt");
  });

  it("assembles generate_voice_message with clone instructions when the endpoint advertises them", () => {
    const tool = buildVoiceMessageToolVariant(new GenerateVoiceMessageTool(), "plain", {
      voiceInstructionsAvailable: true,
    });

    expect(getPropertyNames(tool)).toEqual(["script", "title", "voice_instructions"]);
    expect(tool.parameters.properties.voice_instructions?.description).toContain("one-off delivery");
  });

  it("assembles clone instructions from the active endpoint capability", async () => {
    const assembled = await assembleToolsForContext([new GenerateVoiceMessageTool()], createAssemblyContext());
    const tool = assembled[0];

    expect(tool).toBeDefined();
    expect(getPropertyNames(tool as Tool)).toContain("voice_instructions");
  });
});

describe("Danbooru Search toggle", () => {
  const danbooruTools = (): Tool[] => [
    new DanbooruSearchTagsTool(),
    new DanbooruGetPostTool(),
    new DanbooruSearchPostsTool(),
  ];

  it("withholds every Danbooru tool from the assembled list when the toggle is off", () => {
    const names = (enabled: boolean) => {
      const state = createAssemblyState();
      return getAvailableToolsForContext(danbooruTools(), "google", {
        ...state,
        config: { ...state.config, danbooru_enabled: enabled },
      }).map((tool) => tool.name);
    };

    expect(names(true)).toEqual(danbooruTools().map((tool) => tool.name));
    expect(names(false)).toEqual([]);
  });
});
