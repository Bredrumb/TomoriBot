import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  Client,
  EmbedBuilder,
} from "discord.js";
import sharp from "sharp";
import { execute as image } from "@/commands/generate/image";
import { execute as naiImage } from "@/commands/novelai/generate/image";
import * as states from "@/utils/cache/tomoriStateCache";
import * as crypto from "@/utils/security/crypto";
import * as naiModels from "@/utils/image/naiDiffusionModels";
import * as naiGeneration from "@/utils/image/naiImageGeneration";
import { execute as video } from "@/commands/generate/video";
import {
  customEndpointSchema,
  diffusionModelSchema,
  savedProviderConfigSchema,
  videoGenerationModelSchema,
} from "@/types/db/schema";
import * as dispatcher from "@/providers/custom/customEndpointDispatcher";
import { llmModelRepo, personaRepository, statRepository } from "@/utils/db/repositories";
import * as modals from "@/utils/discord/ui/modals";
import * as credentials from "@/utils/provider/credentialResolver";
import * as providerOptions from "@/utils/provider/providerOptionRegistry";
import * as personal from "@/utils/provider/personalProviderRuntime";
import * as imageQuota from "@/utils/quota/imageQuotaManager";
import * as videoQuota from "@/utils/quota/videoQuotaManager";
import { log } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import * as downloads from "@/utils/security/safeDownload";
import * as nvidia from "@/providers/nvidia/nvidiaImageGeneration";
import * as zai from "@/providers/zai/zaiImageGeneration";
import { STUB_PUBLIC_HOST, stubGlobalFetch } from "../../helpers/fetchStub";

let png: Buffer;
let modal: ReturnType<typeof makeFakeInteraction>;
const state = createPersona({
  config: {
    imagegen_enabled: true,
    videogen_enabled: true,
    nai_diffusion_model_id: 3,
    diffusion_model_id: 1,
    video_model_id: 2,
  },
});
const endpoint = customEndpointSchema.parse({
  connection_id: 1,
  custom_endpoint_id: 1,
  server_id: 1,
  user_id: null,
  label: "Media fixture",
  capability: "image",
  api_style: "comfyui",
  endpoint_url: "http://127.0.0.1:9001",
  requires_auth: false,
});

beforeAll(async () => {
  await initializeLocalizer();
  png = await sharp({ create: { width: 1, height: 1, channels: 4, background: "white" } })
    .png()
    .toBuffer();
});
beforeEach(() => {
  modal = makeFakeInteraction();
  spyOn(personaRepository, "loadState").mockResolvedValue(state);
  spyOn(states, "getCachedTomoriState").mockResolvedValue(state);
  spyOn(crypto, "getOptApiKey").mockResolvedValue("synthetic-nai-key");
  spyOn(naiModels, "resolveNaiDiffusionModel").mockResolvedValue({
    diffusionModelId: 3,
    codename: "nai-diffusion-4-5-full",
    source: "override",
  });
  spyOn(naiGeneration, "generateNovelAiImage").mockImplementation(async () => png);
  spyOn(personal, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
    tomoriState: state,
    activeConfigs: {},
  });
  spyOn(credentials, "resolveCapabilityCredentials").mockImplementation(async (_server, capability) => ({
    provider: "custom:1",
    source: "server",
    apiKey: "",
    keyVersion: 1,
    customEndpoint: endpoint,
    modelId: capability === "video" ? 2 : 1,
    savedConfig: savedProviderConfigSchema.parse({
      server_id: 1,
      provider: "custom:1",
      api_key: null,
      llm_id: null,
      diffusion_model_id: 1,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
    }),
  }));
  spyOn(llmModelRepo, "loadDiffusionModelById").mockResolvedValue(
    diffusionModelSchema.parse({ diffusion_model_id: 1, provider: "custom:1", codename: "image-model" }),
  );
  spyOn(llmModelRepo, "loadVideoGenerationModelById").mockResolvedValue(
    videoGenerationModelSchema.parse({ video_model_id: 2, provider: "custom:1", codename: "video-model" }),
  );
  spyOn(modals, "promptWithRawModal").mockImplementation(async () => {
    await modal.interaction.deferReply();
    return {
      outcome: "submit",
      interaction: modal.interaction as unknown as ModalSubmitInteraction,
      values: {
        nai_image_prompt: "fixture prompt",
        nai_image_orientation: "portrait",
        prompt_input: "fixture prompt",
        aspect_ratio_select: "1:1",
        duration_input: "5",
      },
      attachments: {},
    };
  });
  spyOn(dispatcher, "generateCustomImageViaEndpoint").mockImplementation(async () => ({
    imageData: png.toString("base64"),
    mimeType: "image/png",
  }));
  spyOn(dispatcher, "generateCustomVideoViaEndpoint").mockImplementation(async () => ({
    videoData: Buffer.from("fixture video"),
    mimeType: "video/mp4",
    filename: "generated.mp4",
  }));
  spyOn(imageQuota, "checkImageQuota").mockResolvedValue({ allowed: true });
  spyOn(imageQuota, "incrementImageQuota").mockResolvedValue(undefined);
  spyOn(videoQuota, "checkVideoQuota").mockResolvedValue({ allowed: true });
  spyOn(videoQuota, "incrementVideoQuota").mockResolvedValue(undefined);
  spyOn(statRepository, "recordStat").mockImplementation(() => undefined);
});
afterEach(() => mock.restore());

describe("Generation command spoilers", () => {
  it("spoils image and video attachments only when requested and keeps the flag out of generation requests", async () => {
    for (const command of [image, video, naiImage]) {
      for (const spoiler of [null, false, true]) {
        modal = makeFakeInteraction();
        const { interaction } = makeFakeInteraction({
          channel: {},
          options: {
            getString: (name) => (name === "mode" ? "manual" : null),
            getBoolean: () => spoiler,
          },
        });
        await command({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");
        const payloads = modal.calls
          .filter((call) => call.method === "editReply")
          .map((call) => call.args[0] as { files?: AttachmentBuilder[]; embeds?: EmbedBuilder[] });
        const output = payloads.find((payload) => payload.files?.length);
        expect(output?.files?.[0].spoiler).toBe(spoiler === true);
        if (command !== video) expect(Boolean(output?.embeds?.[0].data.image)).toBe(spoiler !== true);
      }
    }
    for (const method of [
      dispatcher.generateCustomImageViaEndpoint,
      dispatcher.generateCustomVideoViaEndpoint,
      naiGeneration.generateNovelAiImage,
    ]) {
      for (const [request] of (method as ReturnType<typeof spyOn>).mock.calls) {
        expect(request).not.toHaveProperty("nsfw");
        expect(request).toMatchObject({ prompt: expect.stringContaining("fixture prompt") });
      }
    }
  });
});

describe("Media generation failures", () => {
  it("sends reference-image warnings through the acknowledged modal and continues generation", async () => {
    spyOn(downloads, "safeDownload").mockResolvedValue({ success: true, buffer: png, contentType: "image/png" });
    for (const provider of ["nvidia", "zai"] as const) {
      modal = makeFakeInteraction();
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
        provider,
        source: "personal",
        apiKey: "fixture-key",
        keyVersion: 1,
        modelId: 1,
        savedConfig: savedProviderConfigSchema.parse({
          server_id: 1,
          provider,
          api_key: null,
          llm_id: null,
          diffusion_model_id: 1,
          embedding_model_id: null,
          nai_diffusion_model_id: null,
          nai_preset_name: null,
        }),
      });
      const generate =
        provider === "nvidia" ? spyOn(nvidia, "generateNvidiaNativeImage") : spyOn(zai, "generateZaiNativeImage");
      generate.mockResolvedValue({ imageData: png.toString("base64"), mimeType: "image/png" });
      spyOn(modals, "promptWithRawModal").mockImplementation(async () => {
        await modal.interaction.deferReply();
        return {
          outcome: "submit",
          interaction: modal.interaction as unknown as ModalSubmitInteraction,
          values: { prompt_input: "fixture prompt", aspect_ratio_select: "1:1" },
          attachments: {
            image_upload_1: {
              id: "fixture-upload",
              filename: "reference.png",
              url: "https://cdn.example.com/reference.png",
              proxy_url: "https://cdn.example.com/reference.png",
              content_type: "image/png",
              size: png.length,
            },
          },
        };
      });
      const originalFollowUp = mock(async () => {
        throw new Error("Original command interaction was not acknowledged");
      });
      const { interaction } = makeFakeInteraction({
        channel: {},
        followUp: originalFollowUp,
        options: { getString: (name) => (name === "mode" ? "manual" : null), getBoolean: () => false },
      });
      await image({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");
      expect(originalFollowUp).not.toHaveBeenCalled();
      expect(modal.calls.some((call) => call.method === "followUp")).toBe(true);
      expect(generate).toHaveBeenCalled();
      expect(
        modal.calls.some(
          (call) => call.method === "editReply" && Boolean((call.args[0] as { files?: unknown[] }).files?.length),
        ),
      ).toBe(true);
    }
  });

  it("classifies real custom image and video HTTP failures as warnings or operational errors", async () => {
    const errorLog = spyOn(log, "error").mockResolvedValue(undefined);
    const warnLog = spyOn(log, "warn").mockImplementation(() => {});
    const baseCredentials = await credentials.resolveCapabilityCredentials(1, "image-standard");
    spyOn(credentials, "resolveCapabilityCredentials").mockImplementation(async (_server, capability) => ({
      ...baseCredentials,
      modelId: capability === "video" ? 2 : 1,
      customEndpoint: customEndpointSchema.parse({
        ...endpoint,
        capability: capability === "video" ? "video" : "image",
        api_style: "openai-compatible",
        endpoint_url: `https://${STUB_PUBLIC_HOST}/v1`,
      }),
    }));
    spyOn(dispatcher, "generateCustomImageViaEndpoint").mockRestore();
    spyOn(dispatcher, "generateCustomVideoViaEndpoint").mockRestore();
    let responseStatus = 401;
    const fetch = stubGlobalFetch(
      async () => new Response("UPSTREAM_AUTH", { status: responseStatus, statusText: "Fixture status" }),
    );
    for (const [command, errorType] of [
      [image, "ImageGenerationFailed"],
      [video, "VideoGenerationFailed"],
    ] as const) {
      for (const status of [401, 403, 422]) {
        responseStatus = status;
        errorLog.mockClear();
        warnLog.mockClear();
        fetch.mockClear();
        modal = makeFakeInteraction();
        const { interaction } = makeFakeInteraction({
          channel: {},
          options: { getString: (name) => (name === "mode" ? "manual" : null), getBoolean: () => false },
        });
        await command({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(errorLog.mock.calls.filter((call) => call[2]?.errorType === errorType).length).toBe(
          status === 422 ? 1 : 0,
        );
        const warnings = warnLog.mock.calls.filter((call) => call[2]?.errorType === errorType);
        expect(warnings.length).toBe(status === 422 ? 0 : 1);
        if (status !== 422) expect(warnings[0]?.[1]).toMatchObject({ status });
      }
    }
  });

  it("acknowledges missing-credential errors before awaiting recovery copy and leaves successful modal flows alone", async () => {
    for (const command of [image, video]) {
      const pending = Promise.withResolvers<string[]>();
      const entered = Promise.withResolvers<void>();
      const { interaction, calls } = makeFakeInteraction({
        channel: {},
        options: { getString: (name) => (name === "mode" ? "manual" : null), getBoolean: () => null },
      });
      let acknowledged = false;
      const copy = spyOn(providerOptions, "withProviderOptionCopy").mockImplementation(async (_keys, context) => {
        acknowledged = interaction.deferred;
        expect(context).toMatchObject({
          surface: "recovery",
          userDiscId: interaction.user.id,
          credentialScope: "personal",
          managedProvider: null,
        });
        entered.resolve();
        return pending.promise;
      });
      spyOn(credentials, "resolveCapabilityCredentials").mockRejectedValue(
        new credentials.PersonalProviderRequiredError(command === image ? "image-standard" : "video"),
      );
      const execution = command(
        {} as Client,
        interaction as unknown as ChatInputCommandInteraction,
        createUserRow(),
        "en-US",
      );
      await entered.promise;
      expect(acknowledged).toBe(true);
      expect(calls.map(({ method }) => method)).toEqual(["deferReply"]);
      pending.resolve([]);
      await execution;
      expect(calls.some(({ method }) => method === "editReply")).toBe(true);
      expect(modals.promptWithRawModal).not.toHaveBeenCalled();
      copy.mockRestore();
    }
  });

  it("keeps quota and safety refusals out of error_logs while still logging other failures", async () => {
    const errorLog = spyOn(log, "error").mockResolvedValue(undefined);
    const warnLog = spyOn(log, "warn").mockImplementation(() => undefined);
    for (const [command, endpoint, summary] of [
      [image, "generateCustomImageViaEndpoint", "Image generation failed"],
      [video, "generateCustomVideoViaEndpoint", "Video generation command failed"],
    ] as const) {
      for (const [message, expected] of [
        ["RESOURCE_EXHAUSTED: You exceeded your current quota", true],
        ["Prompt blocked by the provider's safety filter", true],
        ["Upstream returned malformed output", false],
      ] as const) {
        errorLog.mockClear();
        warnLog.mockClear();
        modal = makeFakeInteraction();
        spyOn(dispatcher, endpoint).mockRejectedValue(new Error(message));
        const { interaction } = makeFakeInteraction({
          channel: {},
          options: { getString: (name) => (name === "mode" ? "manual" : null), getBoolean: () => null },
        });
        await command({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");
        const recorded = (calls: unknown[][]) => calls.some(([text]) => String(text).startsWith(summary));
        expect(recorded(errorLog.mock.calls)).toBe(!expected);
        expect(recorded(warnLog.mock.calls)).toBe(expected);
      }
    }
  });
});
