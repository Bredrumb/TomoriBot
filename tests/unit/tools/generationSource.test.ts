import { afterEach, beforeAll, expect, it, mock, spyOn } from "bun:test";
import type { Client, Message } from "discord.js";
import sharp from "sharp";
import { GenerateImageTool } from "@/tools/functionCalls/generateImageTool";
import { GenerateImageNaiTool } from "@/tools/functionCalls/generateImageNaiTool";
import { GenerateVideoTool } from "@/tools/functionCalls/generateVideoTool";
import {
  customEndpointSchema,
  diffusionModelSchema,
  userSavedProviderConfigSchema,
  videoGenerationModelSchema,
} from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import * as dispatcher from "@/providers/custom/customEndpointDispatcher";
import { llmModelRepo } from "@/utils/db/repositories";
import * as delivery from "@/utils/discord/webhook/toolMediaDelivery";
import * as minimalNoticeBodies from "@/utils/discord/minimalNoticeBodies";
import * as naiModels from "@/utils/image/naiDiffusionModels";
import * as naiGeneration from "@/utils/image/naiImageGeneration";
import * as credentials from "@/utils/provider/credentialResolver";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { localizedProse } from "../../helpers/localeCases";

let png: Buffer;
beforeAll(async () => {
  await initializeLocalizer();
  png = await sharp({ create: { width: 1, height: 1, channels: 4, background: "white" } })
    .png()
    .toBuffer();
});
afterEach(() => mock.restore());

it("returns the resolved generation provider and model independently of the chat route and notice verbosity", async () => {
  const context: ToolContext = {
    channel: { id: "fixture-channel" } as ToolContext["channel"],
    client: {} as Client,
    tomoriState: createPersona({ config: { imagegen_enabled: true, videogen_enabled: true } }),
    locale: "en-US",
    provider: "openrouter",
    userId: "200000000000000002",
    suppressProgressNotices: true,
  };
  const endpoint = customEndpointSchema.parse({
    connection_id: 1,
    custom_endpoint_id: 1,
    server_id: null,
    user_id: 1,
    capability: "image",
    api_style: "openai-compatible",
    label: "Fixture endpoint",
    model_name: "fixture/endpoint-model",
    endpoint_url: "https://endpoint.invalid/v1",
    requires_auth: false,
  });
  spyOn(credentials, "resolveCapabilityCredentials").mockImplementation(async (_server, capability) => {
    const provider = capability === "image-nai" ? "novelai" : "custom:1";
    return {
      provider,
      source: "personal",
      apiKey: "synthetic-credential",
      keyVersion: 1,
      modelId: capability === "video" ? 2 : 1,
      ...(capability === "image-nai" ? {} : { customEndpoint: endpoint }),
      savedConfig: userSavedProviderConfigSchema.parse({
        user_id: 1,
        provider,
        api_key: null,
        llm_id: null,
        diffusion_model_id: 1,
        embedding_model_id: null,
        nai_diffusion_model_id: 1,
        nai_preset_name: null,
      }),
    };
  });
  spyOn(llmModelRepo, "loadDiffusionModelById").mockResolvedValue(
    diffusionModelSchema.parse({ diffusion_model_id: 1, provider: "custom:1", codename: "fixture/catalog-model" }),
  );
  spyOn(llmModelRepo, "loadVideoGenerationModelById").mockResolvedValue(
    videoGenerationModelSchema.parse({ video_model_id: 2, provider: "custom:1", codename: "fixture/catalog-model" }),
  );
  spyOn(dispatcher, "generateCustomImageViaEndpoint").mockImplementation(async () => ({
    imageData: png.toString("base64"),
    mimeType: "image/png",
  }));
  spyOn(dispatcher, "generateCustomVideoViaEndpoint").mockResolvedValue({
    videoData: Buffer.from("video"),
    mimeType: "video/mp4",
  });
  spyOn(naiModels, "resolveNaiDiffusionModel").mockResolvedValue({
    diffusionModelId: 1,
    codename: "nai-diffusion-4-5-full",
    source: "override",
  });
  spyOn(naiGeneration, "generateNovelAiImage").mockImplementation(async () => png);
  const send = spyOn(delivery, "sendToolMediaPost").mockResolvedValue({ id: "300000000000000003" } as Message);
  const record = spyOn(minimalNoticeBodies, "recordMinimalNoticeRef").mockResolvedValue(undefined);

  for (const verbosity of ["minimal", "verbose"] as const) {
    context.tomoriState.config.tool_notice_verbosity = verbosity;
    for (const tool of [new GenerateImageTool(), new GenerateVideoTool(), new GenerateImageNaiTool()]) {
      const result = await tool.execute({ prompt: "landscape" }, context);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        tool.name === "generate_image_nai"
          ? { provider: "novelai", model: "nai-diffusion-4-5-full" }
          : { provider: "custom:1", model: "fixture/endpoint-model" },
      );
      expect(JSON.stringify(result)).not.toContain(endpoint.endpoint_url);
      expect(JSON.stringify(result)).not.toContain("synthetic-credential");
      const payload = send.mock.calls.at(-1)?.[1]();
      expect(payload).toBeDefined();
      const sourceCopy = localizedProse("en-US", "tools.media.generation_source_line");
      if (verbosity === "verbose") expect(JSON.stringify(payload?.components)).toMatch(sourceCopy);
      else expect(JSON.stringify(payload?.components)).not.toMatch(sourceCopy);
      expect(record).toHaveBeenLastCalledWith("300000000000000003", { kind: "generation", source: result.data });
    }
  }
});
