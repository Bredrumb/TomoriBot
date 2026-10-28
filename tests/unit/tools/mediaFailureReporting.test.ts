import { afterEach, beforeAll, expect, it, mock, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { PeekProfilePictureTool } from "@/tools/functionCalls/peekProfilePictureTool";
import { GenerateImageTool } from "@/tools/functionCalls/generateImageTool";
import { GenerateVideoTool } from "@/tools/functionCalls/generateVideoTool";
import type { ToolContext } from "@/types/tool/interfaces";
import * as avatars from "@/utils/discord/avatarResolver";
import * as credentials from "@/utils/provider/credentialResolver";
import {
  customEndpointSchema,
  diffusionModelSchema,
  userSavedProviderConfigSchema,
  videoGenerationModelSchema,
} from "@/types/db/schema";
import { llmModelRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { STUB_PUBLIC_HOST, stubGlobalFetch } from "../../helpers/fetchStub";

beforeAll(initializeLocalizer);
afterEach(() => mock.restore());

const context: ToolContext = {
  channel: { id: "fixture-channel" } as ToolContext["channel"],
  client: {} as Client,
  tomoriState: createPersona({
    config: { imagegen_enabled: true, diffusion_model_id: 1, videogen_enabled: true, video_model_id: 2 },
  }),
  locale: "en-US",
  provider: "custom:1",
  userId: "fixture-user",
  internalUserId: 1,
  guildId: "fixture-guild",
  suppressProgressNotices: true,
};

it("counts unresolved avatar targets as expected failures and preserves unexpected processing errors", async () => {
  const errors = spyOn(log, "error").mockResolvedValue(undefined);
  const warnings = spyOn(log, "warn").mockImplementation(() => {});
  const resolve = spyOn(avatars, "resolveAvatarByIdentity");
  for (const [message, expected] of [
    ["No user found matching Mirri", true],
    ["Unexpected avatar decoder failure", false],
  ] as const) {
    errors.mockClear();
    warnings.mockClear();
    resolve.mockRejectedValue(new Error(message));
    const result = await new PeekProfilePictureTool().execute({ target_identity: "Mirri" }, context);
    expect(result.success).toBe(false);
    expect(errors.mock.calls.length).toBe(expected ? 0 : 1);
    expect(warnings.mock.calls.length).toBe(expected ? 1 : 0);
  }
});

it("classifies real custom image and video HTTP failures without hiding malformed-request incidents", async () => {
  spyOn(credentials, "resolveCapabilityCredentials").mockImplementation(async (_server, capability) => ({
    provider: "custom:1",
    source: "personal",
    apiKey: "fixture-key",
    keyVersion: 1,
    modelId: capability === "video" ? 2 : 1,
    savedConfig: userSavedProviderConfigSchema.parse({
      user_id: 1,
      provider: "custom:1",
      api_key: null,
      llm_id: null,
      diffusion_model_id: 1,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
    }),
    customEndpoint: customEndpointSchema.parse({
      connection_id: 1,
      custom_endpoint_id: 1,
      server_id: null,
      user_id: 1,
      capability: capability === "video" ? "video" : "image",
      api_style: "openai-compatible",
      label: "Fixture",
      endpoint_url: `https://${STUB_PUBLIC_HOST}/v1`,
      requires_auth: false,
    }),
  }));
  spyOn(llmModelRepo, "loadDiffusionModelById").mockResolvedValue(
    diffusionModelSchema.parse({ diffusion_model_id: 1, provider: "custom:1", codename: "fixture/model" }),
  );
  spyOn(llmModelRepo, "loadVideoGenerationModelById").mockResolvedValue(
    videoGenerationModelSchema.parse({ video_model_id: 2, provider: "custom:1", codename: "fixture/video" }),
  );
  const errors = spyOn(log, "error").mockResolvedValue(undefined);
  const warnings = spyOn(log, "warn").mockImplementation(() => {});
  let responseStatus = 401;
  const fetch = stubGlobalFetch(
    async () => new Response("UPSTREAM_FAILURE", { status: responseStatus, statusText: "Fixture status" }),
  );
  for (const tool of [new GenerateImageTool(), new GenerateVideoTool()]) {
    for (const status of [401, 403, 422]) {
      responseStatus = status;
      errors.mockClear();
      warnings.mockClear();
      fetch.mockClear();
      const result = await tool.execute({ prompt: "fixture prompt" }, context);
      expect(result.success).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failure?.code).toBe(String(status));
      expect(errors.mock.calls.length).toBe(status === 422 ? 1 : 0);
      expect(warnings.mock.calls.length).toBe(status === 422 ? 0 : 1);
      expect(result.error).not.toContain("UPSTREAM_FAILURE");
    }
  }
});

it("reports Z.ai video HTTP failures once with scrubbed provider details and the correct severity", async () => {
  const apiKey = "fixture-zai-credential";
  spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
    provider: "zai",
    source: "personal",
    apiKey,
    keyVersion: 1,
    modelId: 2,
    savedConfig: userSavedProviderConfigSchema.parse({
      user_id: 1,
      provider: "zai",
      api_key: null,
      llm_id: null,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
    }),
  });
  spyOn(llmModelRepo, "loadVideoGenerationModelById").mockResolvedValue(
    videoGenerationModelSchema.parse({ video_model_id: 2, provider: "zai", codename: "cogvideox-3" }),
  );
  const errors = spyOn(log, "error").mockResolvedValue(undefined);
  const warnings = spyOn(log, "warn").mockImplementation(() => {});
  const metrics = spyOn(log, "metric").mockImplementation(() => {});
  let responseStatus = 401;
  let responseBody = "UPSTREAM_ZAI_DETAIL";
  const fetch = stubGlobalFetch(
    async () => new Response(`${responseBody} ${apiKey}`, { status: responseStatus, statusText: "Fixture status" }),
  );
  for (const status of [401, 403, 400, 422]) {
    responseStatus = status;
    responseBody = status === 400 ? "UPSTREAM_ZAI_DETAIL content blocked" : "UPSTREAM_ZAI_DETAIL";
    errors.mockClear();
    warnings.mockClear();
    metrics.mockClear();
    fetch.mockClear();
    const result = await new GenerateVideoTool().execute({ prompt: "fixture prompt" }, context);
    expect(result.success).toBe(false);
    expect(result.failure?.code).toBe(String(status));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls.length).toBe(status === 422 ? 1 : 0);
    expect(warnings.mock.calls.length).toBe(status === 422 ? 0 : 1);
    expect(metrics.mock.calls.length).toBe(status === 422 ? 0 : 1);
    const recorded = status === 422 ? errors.mock.calls[0] : warnings.mock.calls[0];
    expect(recorded?.[1]).toMatchObject({ status, message: expect.stringContaining("UPSTREAM_ZAI_DETAIL") });
    expect(recorded?.[2]?.metadata).toMatchObject({ provider: "zai" });
    const error = recorded?.[1];
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Missing diagnostic error");
    expect(error.message + error.stack).not.toContain(apiKey);
    expect(JSON.stringify(result)).not.toContain("UPSTREAM_ZAI_DETAIL");
    expect(JSON.stringify(result)).not.toContain(apiKey);
  }
});
