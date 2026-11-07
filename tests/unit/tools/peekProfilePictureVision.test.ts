import { afterEach, beforeAll, expect, it, mock, spyOn } from "bun:test";
import type { Client } from "discord.js";
import type { ToolContext } from "@/types/tool/interfaces";
import { userSavedProviderConfigSchema } from "@/types/db/schema";
import * as avatars from "@/utils/discord/avatarResolver";
import * as credentials from "@/utils/provider/credentialResolver";
import { log } from "@/utils/misc/logger";
import * as realRemoteFetch from "@/utils/security/userRemoteFetch";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

const requestedUrls: string[] = [];
const remoteFetch = mock(async (input: RequestInfo | URL) => {
  requestedUrls.push(String(input));
  return Response.json({ choices: [{ message: { content: "A fixture avatar." } }] });
});
const scopedMock = createScopedModuleMocker(mock, { "@/utils/security/userRemoteFetch": realRemoteFetch });
scopedMock.module("@/utils/security/userRemoteFetch", () => ({ ...realRemoteFetch, fetchUserRemoteUrl: remoteFetch }));

const { PeekProfilePictureTool } = await import("@/tools/functionCalls/peekProfilePictureTool");

beforeAll(initializeLocalizer);
afterEach(() => {
  requestedUrls.length = 0;
  remoteFetch.mockClear();
  mock.restore();
});

function contextForVisionProvider(provider: string): ToolContext {
  const visionLlm = createLlmRow({ llm_id: 9, llm_provider: provider, llm_codename: "fixture/vision" });
  return {
    channel: { id: "fixture-channel" } as ToolContext["channel"],
    client: {} as Client,
    tomoriState: createPersona({ llm: createLlmRow({ sees_images: false }), vision_llm: visionLlm }),
    locale: "en-US",
    provider: "google",
    userId: "fixture-user",
    internalUserId: 1,
    guildId: "fixture-guild",
    suppressProgressNotices: true,
  };
}

it("sends a non-vision persona's avatar only to the vision provider's own endpoint", async () => {
  spyOn(log, "error").mockResolvedValue(undefined);
  spyOn(log, "warn").mockImplementation(() => {});
  spyOn(avatars, "resolveAvatarByIdentity").mockResolvedValue({
    sourceType: "user",
    username: "Juno",
    avatarUrl: "data:image/png;base64,aW1hZ2U=",
  });

  for (const [provider, expectedUrl] of [
    ["nvidia", "https://integrate.api.nvidia.com/v1/chat/completions"],
    ["nonexistent-provider", null],
  ] as const) {
    requestedUrls.length = 0;
    spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
      provider,
      source: "personal",
      apiKey: "fixture-vision-key",
      keyVersion: 1,
      modelId: 9,
      savedConfig: userSavedProviderConfigSchema.parse({
        user_id: 1,
        provider,
        api_key: null,
        llm_id: null,
        diffusion_model_id: null,
        embedding_model_id: null,
        nai_diffusion_model_id: null,
        nai_preset_name: null,
      }),
    });

    const result = await new PeekProfilePictureTool().execute(
      { target_identity: "Juno" },
      contextForVisionProvider(provider),
    );

    expect(result.success).toBe(expectedUrl !== null);
    expect(requestedUrls).toEqual(expectedUrl ? [expectedUrl] : []);
  }
});
