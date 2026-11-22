import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { GenerateImageTool, loadIdentityCharacterReference } from "@/tools/functionCalls/generateImageTool";
import { customEndpointSchema, PrivacyLevel, userSavedProviderConfigSchema } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import * as mediaQuotaGate from "@/utils/quota/mediaQuotaGate";
import type { ResolvedAvatarData } from "@/utils/discord/avatarResolver";
import { llmModelRepo } from "@/utils/db/repositories";
import { createPersona, createUserRow } from "../../helpers/fixtures";

const GUILD_ID = "100000000000000001";
const USER_DISC_ID = "200000000000000002";

function personaAvatar(personaId: number): ResolvedAvatarData {
  return { sourceType: "persona", username: "Mirri", avatarUrl: "https://cdn.invalid/p.png", personaId };
}

function userAvatar(): ResolvedAvatarData {
  return { sourceType: "user", username: "Juno", avatarUrl: "https://cdn.invalid/u.png", userDiscId: USER_DISC_ID };
}

function dependencies(overrides: { personaRef?: string | null; userRef?: string | null; privacy?: PrivacyLevel }) {
  const loadReference = mock(async (url: string) => `base64:${url}`);
  return {
    loadReference,
    deps: {
      loadPersonas: async () => [createPersona({ persona_id: 7, char_ref_url: overrides.personaRef ?? null })],
      loadUser: async () =>
        createUserRow({
          user_disc_id: USER_DISC_ID,
          char_ref_url: overrides.userRef ?? null,
          privacy_level: overrides.privacy ?? PrivacyLevel.MINIMAL,
        }),
      loadReference,
    },
  };
}

describe("generate_image identity character references", () => {
  it("uses a persona's saved reference from that persona's own storage", async () => {
    const { deps, loadReference } = dependencies({ personaRef: "data/charreferences/personas/7/a.png" });

    await expect(loadIdentityCharacterReference(personaAvatar(7), GUILD_ID, deps)).resolves.toBe(
      "base64:data/charreferences/personas/7/a.png",
    );
    expect(loadReference).toHaveBeenCalledWith("data/charreferences/personas/7/a.png", "personas", 7);
  });

  it("falls back to the avatar when the persona has no saved reference", async () => {
    const { deps, loadReference } = dependencies({ personaRef: null });

    await expect(loadIdentityCharacterReference(personaAvatar(7), GUILD_ID, deps)).resolves.toBeNull();
    expect(loadReference).not.toHaveBeenCalled();
  });

  it("uses a user's saved reference keyed by their Discord ID", async () => {
    const { deps, loadReference } = dependencies({ userRef: "data/charreferences/users/200000000000000002/a.png" });

    await expect(loadIdentityCharacterReference(userAvatar(), GUILD_ID, deps)).resolves.not.toBeNull();
    expect(loadReference).toHaveBeenCalledWith(
      "data/charreferences/users/200000000000000002/a.png",
      "users",
      USER_DISC_ID,
    );
  });

  it("keeps a Full-privacy user's upload out of the generation", async () => {
    const { deps, loadReference } = dependencies({
      userRef: "data/charreferences/users/200000000000000002/a.png",
      privacy: PrivacyLevel.FULL,
    });

    await expect(loadIdentityCharacterReference(userAvatar(), GUILD_ID, deps)).resolves.toBeNull();
    expect(loadReference).not.toHaveBeenCalled();
  });
});

describe("generate_image edit target", () => {
  afterEach(() => mock.restore());

  function createEditContext(): ToolContext {
    return {
      channel: { id: "fixture-channel" } as ToolContext["channel"],
      client: {} as Client,
      tomoriState: createPersona({ config: { imagegen_enabled: true } }),
      locale: "en-US",
      provider: "custom:1",
      userId: USER_DISC_ID,
      guildId: GUILD_ID,
      suppressProgressNotices: true,
    };
  }

  it("refuses masked edits with multiple references and no explicit target", async () => {
    const resolveCredentials = spyOn(mediaQuotaGate, "resolveCredentialsWithMediaQuota");
    const context = createEditContext();

    for (const flags of [
      { edit_mode: "inpaint", mask_prompt: "hat" },
      { edit_mode: "extend", mask_prompt: "hat" },
      { edit_mode: "outpaint" },
    ]) {
      const result = await new GenerateImageTool().execute(
        { prompt: "fixture prompt", references: ["Mirri", "Juno"], ...flags },
        context,
      );
      expect(result.success).toBe(false);
    }
    expect(resolveCredentials).not.toHaveBeenCalled();
  });

  it("rejects implicit edits and retired mode flags before reserving quota", async () => {
    const resolveCredentials = spyOn(mediaQuotaGate, "resolveCredentialsWithMediaQuota");
    const context = createEditContext();
    const tool = new GenerateImageTool();

    for (const controls of [
      { mask_prompt: "hat" },
      { outpaint_amount: "large" },
      { inpaint: true },
      { inpaint_mode: "extend" },
      { outpaint: true },
    ]) {
      const result = await tool.execute({ prompt: "Landscape", references: ["Mirri"], ...controls }, context);
      expect(result.success).toBe(false);
    }
    expect(resolveCredentials).not.toHaveBeenCalled();
  });

  it("rejects edits when the resolved image endpoint cannot execute them", async () => {
    const context = createEditContext();
    const endpoint = customEndpointSchema.parse({
      connection_id: 1,
      custom_endpoint_id: 1,
      user_id: 1,
      capability: "image",
      api_style: "openai-compatible",
      label: "Fixture endpoint",
      endpoint_url: "https://endpoint.invalid",
      requires_auth: false,
    });
    const resolveCredentials = spyOn(mediaQuotaGate, "resolveCredentialsWithMediaQuota").mockResolvedValue({
      credentials: {
        provider: "custom:1",
        source: "personal",
        apiKey: "synthetic-credential",
        keyVersion: 1,
        modelId: 1,
        customEndpoint: endpoint,
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
      },
      quotaCheck: { allowed: true, reservation: null },
    });
    const loadModel = spyOn(llmModelRepo, "loadDiffusionModelById");

    const result = await new GenerateImageTool().execute(
      { prompt: "A red hat", edit_mode: "inpaint", mask_prompt: "hat", references: ["Mirri"] },
      context,
    );

    expect(result.success).toBe(false);
    expect(resolveCredentials).toHaveBeenCalled();
    expect(loadModel).not.toHaveBeenCalled();
  });
});
