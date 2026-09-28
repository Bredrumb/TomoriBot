import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type {
  CustomEndpointConnectionRow,
  SavedProviderConfigRow,
  UserSavedProviderConfigRow,
} from "@/types/db/schema";
import { llmProviderRepo } from "@/utils/db/repositories";
import { buildCustomProviderName } from "@/utils/provider/customProviderUtils";
import {
  loadSavedProvidersForCapability,
  loadUserSavedProvidersForCapability,
} from "@/utils/provider/savedProviderConfig";

function makeSavedRow(overrides: Partial<SavedProviderConfigRow> & { provider: string }): SavedProviderConfigRow {
  return {
    server_id: 1,
    api_key: null,
    key_version: 1,
    llm_id: null,
    diffusion_model_id: null,
    embedding_model_id: null,
    nai_diffusion_model_id: null,
    video_model_id: null,
    vision_llm_id: null,
    ...overrides,
  } as unknown as SavedProviderConfigRow;
}

function makeUserSavedRow(
  overrides: Partial<UserSavedProviderConfigRow> & { provider: string },
): UserSavedProviderConfigRow {
  return {
    user_id: 1,
    api_key: null,
    key_version: 1,
    llm_id: null,
    diffusion_model_id: null,
    embedding_model_id: null,
    nai_diffusion_model_id: null,
    video_model_id: null,
    vision_llm_id: null,
    enabled_capabilities: [],
    assigned_capabilities: [],
    fallback_model_refs: [],
    ...overrides,
  } as unknown as UserSavedProviderConfigRow;
}

function makeConnection(
  overrides: Partial<CustomEndpointConnectionRow> & { connection_id: number },
): CustomEndpointConnectionRow {
  return {
    label: "test",
    capability: "text",
    api_style: "openai",
    endpoint_url: "https://example.test/v1",
    requires_auth: true,
    ...overrides,
  } as unknown as CustomEndpointConnectionRow;
}

function stubConnections(
  connections: CustomEndpointConnectionRow[],
  endpointsByConnection: Map<number, Array<{ capability: string; sees_images: boolean }>>,
): void {
  spyOn(llmProviderRepo, "loadCustomEndpointConnectionById").mockImplementation(
    async (connectionId: number) => connections.find((row) => row.connection_id === connectionId) ?? null,
  );
  spyOn(llmProviderRepo, "loadCustomEndpointsByConnectionId").mockImplementation(
    async (connectionId: number) =>
      (endpointsByConnection.get(connectionId) ?? []).map((row) => ({
        ...row,
        connection_id: connectionId,
      })) as never,
  );
}

afterEach(() => {
  spyOn(llmProviderRepo, "loadSavedProviderConfigs").mockRestore();
  spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockRestore();
  spyOn(llmProviderRepo, "loadCustomEndpointConnectionById").mockRestore();
  spyOn(llmProviderRepo, "loadCustomEndpointsByConnectionId").mockRestore();
});

describe("saved provider capability filters", () => {
  it("applies the static provider capability matrix to non-custom rows", async () => {
    // google advertises vision and embeddings; novelai advertises neither.
    spyOn(llmProviderRepo, "loadSavedProviderConfigs").mockImplementation(async () => [
      makeSavedRow({ provider: "google" }),
      makeSavedRow({ provider: "novelai" }),
    ]);

    expect((await loadSavedProvidersForCapability(1, "vision")).map((row) => row.provider)).toEqual(["google"]);
    expect((await loadSavedProvidersForCapability(1, "embedding")).map((row) => row.provider)).toEqual(["google"]);
  });

  it("requires a saved model selection on custom rows but not for vision", async () => {
    const customProvider = buildCustomProviderName(41);
    // A server-scoped connection, because both loaders verify the scope they were called for.
    spyOn(llmProviderRepo, "loadSavedProviderConfigs").mockImplementation(async () => [
      makeSavedRow({ provider: customProvider }),
      makeSavedRow({ provider: customProvider, llm_id: 900 }),
    ]);
    stubConnections(
      [makeConnection({ connection_id: 41, server_id: 1 })],
      new Map([[41, [{ capability: "text", sees_images: true }]]]),
    );

    // Vision has no saved selection to require, so both rows are eligible.
    expect((await loadSavedProvidersForCapability(1, "vision")).length).toBe(2);
    // Text still requires the selection, so only the row carrying an llm_id survives.
    const textRows = await loadSavedProvidersForCapability(1, "text");
    expect(textRows.length).toBe(1);
    expect(textRows[0]?.llm_id).toBe(900);
  });

  it("hides a custom row whose registered endpoint does not serve the capability", async () => {
    const customProvider = buildCustomProviderName(42);
    spyOn(llmProviderRepo, "loadSavedProviderConfigs").mockImplementation(async () => [
      makeSavedRow({ provider: customProvider, llm_id: 901 }),
    ]);
    // The connection is registered for image generation, not text.
    stubConnections([makeConnection({ connection_id: 42, server_id: 1, capability: "image" })], new Map());

    expect(await loadSavedProvidersForCapability(1, "text")).toEqual([]);
  });

  it("keeps server and user scopes apart when both hold a connection with the same id", async () => {
    const customProvider = buildCustomProviderName(43);
    spyOn(llmProviderRepo, "loadSavedProviderConfigs").mockImplementation(async () => [
      makeSavedRow({ provider: customProvider, llm_id: 902 }),
    ]);
    spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockImplementation(async () => [
      makeUserSavedRow({ provider: customProvider, llm_id: 903 }),
    ]);
    // The connection belongs to the user, so the server-scoped lookup must not claim it.
    stubConnections([makeConnection({ connection_id: 43, user_id: 7 })], new Map());

    expect(await loadSavedProvidersForCapability(1, "text")).toEqual([]);
    expect((await loadUserSavedProvidersForCapability(7, "text")).map((row) => row.llm_id)).toEqual([903]);
  });
});
