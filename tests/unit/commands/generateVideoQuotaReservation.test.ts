import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { execute as videoCommand } from "@/commands/generate/video";
import { customEndpointSchema, savedProviderConfigSchema, videoGenerationModelSchema } from "@/types/db/schema";
import * as dispatcher from "@/providers/custom/customEndpointDispatcher";
import { llmModelRepo, personaRepository, statRepository } from "@/utils/db/repositories";
import * as modals from "@/utils/discord/ui/modals";
import * as credentials from "@/utils/provider/credentialResolver";
import * as personal from "@/utils/provider/personalProviderRuntime";
import * as videoQuota from "@/utils/quota/videoQuotaManager";
import { QuotaUnavailableError } from "@/utils/quota/quotaErrors";
import type { QuotaReservation } from "@/utils/db/repositories/QuotaRepository";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { localizedCopy, localizedProse } from "../../helpers/localeCases";

const state = createPersona({
  config: { videogen_enabled: true, video_model_id: 2 },
});
const endpoint = customEndpointSchema.parse({
  connection_id: 1,
  custom_endpoint_id: 1,
  server_id: 1,
  user_id: null,
  label: "Quota fixture",
  capability: "video",
  api_style: "comfyui",
  endpoint_url: "http://127.0.0.1:9001",
  requires_auth: false,
});
const reservation: QuotaReservation = {
  quotaDate: "2026-10-28",
  userCounted: true,
  serverwidePeriodStart: null,
};

let modal: ReturnType<typeof makeFakeInteraction>;
let reserveResult: Awaited<ReturnType<typeof videoQuota.reserveVideoQuota>>;
let reserveError: Error | null;
let providerError: Error | null;
let providerCalls: number;
const release = { calls: [] as Array<{ serverId: number; userDiscId: string; reservation: QuotaReservation }> };

beforeAll(initializeLocalizer);

beforeEach(() => {
  modal = makeFakeInteraction();
  providerCalls = 0;
  reserveError = null;
  providerError = null;
  release.calls = [];
  reserveResult = { allowed: true, reservation };

  spyOn(personaRepository, "loadState").mockResolvedValue(state);
  spyOn(personal, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
    tomoriState: state,
    activeConfigs: {},
  });
  spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
    provider: "custom:1",
    source: "server",
    apiKey: "",
    keyVersion: 1,
    customEndpoint: endpoint,
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
  });
  spyOn(llmModelRepo, "loadVideoGenerationModelById").mockResolvedValue(
    videoGenerationModelSchema.parse({ video_model_id: 2, provider: "custom:1", codename: "video-model" }),
  );
  spyOn(statRepository, "recordStat").mockImplementation(() => undefined);
  spyOn(modals, "promptWithRawModal").mockImplementation(async () => {
    await modal.interaction.deferReply();
    return {
      outcome: "submit",
      interaction: modal.interaction as unknown as ModalSubmitInteraction,
      values: {
        prompt_input: "quota fixture prompt",
        aspect_ratio_select: "1:1",
        duration_input: "5",
        fps_input: "",
      },
      attachments: {},
    };
  });
  spyOn(videoQuota, "checkVideoQuota").mockResolvedValue({ allowed: true });
  spyOn(videoQuota, "reserveVideoQuota").mockImplementation(async () => {
    if (reserveError) throw reserveError;
    return reserveResult;
  });
  spyOn(videoQuota, "releaseVideoQuota").mockImplementation(async (serverId, userDiscId, claimed) => {
    release.calls.push({ serverId, userDiscId, reservation: claimed });
  });
  spyOn(dispatcher, "generateCustomVideoViaEndpoint").mockImplementation(async () => {
    providerCalls++;
    if (providerError) throw providerError;
    return {
      videoData: Buffer.from("fixture video"),
      mimeType: "video/mp4",
      filename: "generated.mp4",
    };
  });
});

afterEach(() => mock.restore());

async function executeVideo(): Promise<void> {
  const { interaction } = makeFakeInteraction({ channel: {} });
  await videoCommand({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");
}

function modalPayloadText(): string {
  return JSON.stringify(modal.calls);
}

function modalDescriptions(): string[] {
  return modal.calls.flatMap((call) => {
    const payload = call.args[0] as { embeds?: Array<{ data?: { description?: string } }> } | undefined;
    return payload?.embeds?.map((embed) => embed.data?.description ?? "") ?? [];
  });
}

describe("generate video quota reservation", () => {
  it("keeps the reservation when the video is delivered", async () => {
    await executeVideo();

    expect(providerCalls).toBe(1);
    expect(release.calls).toEqual([]);
  });

  it("releases the reservation when the provider call fails", async () => {
    providerError = new Error("provider unavailable");

    await executeVideo();

    expect(providerCalls).toBe(1);
    expect(release.calls).toEqual([{ serverId: state.server_id, userDiscId: "fake_user_id", reservation }]);
  });

  it("refuses a claimed unit and never calls the provider when the cap was reached", async () => {
    reserveResult = {
      allowed: false,
      reason: "user_quota_exceeded",
      userRemaining: 0,
      resetTime: new Date(Date.now() + 60_000),
      reservation: null,
    };

    await executeVideo();

    expect(providerCalls).toBe(0);
    expect(release.calls).toEqual([]);
    expect(
      modalDescriptions().some((text) =>
        localizedProse("en-US", "commands.generate.video.user_quota_exceeded_description").test(text),
      ),
    ).toBe(true);
  });

  it("replies with the quota-unavailable copy and skips the provider when the counters cannot be read", async () => {
    reserveError = new QuotaUnavailableError();

    await executeVideo();

    expect(providerCalls).toBe(0);
    expect(release.calls).toEqual([]);
    expect(modalPayloadText()).toContain(
      localizedCopy("en-US", "commands.generate.video.quota_unavailable_description"),
    );
  });
});
