import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { GenerateVideoTool } from "@/tools/functionCalls/generateVideoTool";
import type { ToolContext } from "@/types/tool/interfaces";
import * as dispatcher from "@/providers/custom/customEndpointDispatcher";
import { customEndpointSchema, savedProviderConfigSchema, videoGenerationModelSchema } from "@/types/db/schema";
import type { QuotaReservation } from "@/utils/db/repositories/QuotaRepository";
import { llmModelRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import * as credentials from "@/utils/provider/credentialResolver";
import * as comfyUiHandoff from "@/utils/provider/textModelComfyUiHandoff";
import * as videoQuota from "@/utils/quota/videoQuotaManager";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";

const reservation: QuotaReservation = {
  quotaDate: "2026-11-25",
  userCounted: true,
  serverwidePeriodStart: null,
};

beforeAll(initializeLocalizer);
afterEach(() => mock.restore());

function setUpServerFundedVideo(
  provider: (signal: AbortSignal) => Promise<Buffer>,
  apiStyle: "openai-compatible" | "comfyui" = "openai-compatible",
) {
  const kill = new AbortController();
  const context: ToolContext = {
    channel: { id: "fixture-channel" } as ToolContext["channel"],
    client: {} as Client,
    tomoriState: createPersona({ config: { videogen_enabled: true, video_model_id: 2 } }),
    locale: "en-US",
    provider: "custom:1",
    userId: "member_001",
    internalUserId: 1,
    guildId: "fixture-guild",
    suppressProgressNotices: true,
    abortSignal: kill.signal,
  };
  spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
    provider: "custom:1",
    source: "server",
    apiKey: "fixture-key",
    keyVersion: 1,
    modelId: 2,
    savedConfig: savedProviderConfigSchema.parse({
      server_id: 1,
      provider: "custom:1",
      api_key: null,
      llm_id: null,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
    }),
    customEndpoint: customEndpointSchema.parse({
      connection_id: 1,
      custom_endpoint_id: 1,
      server_id: 1,
      user_id: null,
      capability: "video",
      api_style: apiStyle,
      label: "Fixture",
      endpoint_url: "https://video.example.test/v1",
      requires_auth: true,
    }),
  });
  spyOn(llmModelRepo, "loadVideoGenerationModelById").mockResolvedValue(
    videoGenerationModelSchema.parse({ video_model_id: 2, provider: "custom:1", codename: "fixture/video" }),
  );
  spyOn(videoQuota, "reserveVideoQuota").mockResolvedValue({ allowed: true, reservation });
  const released: QuotaReservation[] = [];
  spyOn(videoQuota, "releaseVideoQuota").mockImplementation(async (_serverId, _userDiscId, claimed) => {
    released.push(claimed);
  });
  const providerCalls = { count: 0 };
  spyOn(dispatcher, "generateCustomVideoViaEndpoint").mockImplementation(async (request) => {
    providerCalls.count++;
    const videoData = await provider(request.abortSignal ?? kill.signal);
    return { videoData, mimeType: "video/mp4", filename: "generated.mp4" };
  });
  spyOn(log, "info").mockImplementation(() => {});
  spyOn(log, "warn").mockImplementation(() => {});
  spyOn(log, "error").mockResolvedValue(undefined);
  return { context, kill, released, providerCalls };
}

describe("video quota settlement when a generation is killed", () => {
  it("keeps the unit when /kill lands after the provider returned the video", async () => {
    const setup = setUpServerFundedVideo(async () => {
      setup.kill.abort();
      return Buffer.from("fixture video");
    });

    const result = await new GenerateVideoTool().execute({ prompt: "fixture prompt" }, setup.context);

    expect(setup.providerCalls.count).toBe(1);
    expect(result.success).toBe(false);
    expect(setup.released).toEqual([]);
  });

  it("keeps the unit when /kill aborts a request the provider already accepted", async () => {
    const setup = setUpServerFundedVideo(async (signal) => {
      setup.kill.abort();
      signal.throwIfAborted();
      return Buffer.from("unreachable");
    });

    await new GenerateVideoTool().execute({ prompt: "fixture prompt" }, setup.context);

    expect(setup.providerCalls.count).toBe(1);
    expect(setup.released).toEqual([]);
  });

  it("refunds the unit when /kill lands before the request is sent", async () => {
    const setup = setUpServerFundedVideo(async () => Buffer.from("unreachable"));
    setup.kill.abort();

    await new GenerateVideoTool().execute({ prompt: "fixture prompt" }, setup.context);

    expect(setup.providerCalls.count).toBe(0);
    expect(setup.released).toEqual([reservation]);
  });

  it("refunds the unit when /kill lands during the ComfyUI handoff, before anything is sent", async () => {
    const setup = setUpServerFundedVideo(async () => Buffer.from("unreachable"), "comfyui");
    spyOn(comfyUiHandoff, "beginTextModelHandoffBeforeComfyUi").mockImplementation(async () => {
      setup.kill.abort();
      return { restore: async () => {} };
    });

    await new GenerateVideoTool().execute({ prompt: "fixture prompt" }, setup.context);

    expect(setup.providerCalls.count).toBe(0);
    expect(setup.released).toEqual([reservation]);
  });
});
