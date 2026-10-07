import { beforeAll, describe, expect, it } from "bun:test";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { callDecisionsForProvider } from "@/providers/utils/providerFeatureExecutors";
import { registerCustomEndpoint } from "@/utils/provider/customEndpointService";
import { createServerConfig } from "../../helpers/fixtures";
import { resetRepository } from "@/utils/db/repositories/ResetRepository";
import { insertFixtures } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Decision model persistence", () => {
  let serverId: number;
  let userId: number;
  beforeAll(async () => {
    await setupTestDb();
    await executeTestSqlFile("src/db/migrations/098_decision_models.sql");
    ({ serverId, userId } = await insertFixtures(testSql));
  });

  it("replays the migration without losing registrations and isolates owners and text catalogs", async () => {
    const id = await llmModelRepo.upsertDecisionModel({
      provider: "openrouter",
      codename: "fixture-decision",
      inputTokenLimit: 8192,
    });
    const registration = await llmProviderRepo.upsertDecisionModelRegistration({ serverId, decisionModelId: id });
    expect(registration).not.toBeNull();
    await expect(executeTestSqlFile("src/db/migrations/098_decision_models.down.sql")).rejects.toThrow();
    expect(await llmProviderRepo.upsertDecisionModelRegistration({ serverId, decisionModelId: id })).toEqual(
      registration,
    );
    await executeTestSqlFile("src/db/migrations/098_decision_models.sql");
    const owned = await llmModelRepo.loadAvailableDecisionModels("openrouter", false, {
      kind: "server",
      ownerId: serverId,
    });
    expect(owned.map((model) => model.decision_model_id)).toContain(id);
    const personal = await llmModelRepo.loadAvailableDecisionModels("openrouter", false, {
      kind: "personal",
      ownerId: userId,
    });
    expect(personal.map((model) => model.decision_model_id)).not.toContain(id);
    expect(
      (
        await llmModelRepo.loadAvailableModelsForProvider("openrouter", false, { kind: "server", ownerId: serverId })
      )?.some((model) => model.llm_codename === "fixture-decision"),
    ).toBe(false);
    expect(
      await llmProviderRepo.deleteOwnedDecisionRegistration({ kind: "personal", ownerId: userId }, "openrouter", id),
    ).toBe(false);
    expect(
      await llmProviderRepo.deleteOwnedDecisionRegistration({ kind: "server", ownerId: serverId }, "openrouter", id),
    ).toBe(true);
    expect(await llmModelRepo.loadDecisionModelByProviderAndCodename("openrouter", "fixture-decision")).toBeNull();
    const seeds = personal.filter((model) => !model.is_scoped_registration);
    expect(seeds.some((model) => model.codename === "typesafe/jev-1.13" && model.input_token_limit === 32000)).toBe(
      true,
    );
    expect(seeds.every((model) => model.provider === "openrouter")).toBe(true);
  });

  it("registers and edits exact custom identities without activating text, then deletes only the owned registration", async () => {
    const input = {
      scope: { kind: "personal" as const, ownerId: userId, baseConfig: createServerConfig() },
      label: "fixture-system-one",
      capability: "decision" as const,
      apiStyle: "system-one" as const,
      endpointUrl: "https://example.invalid/gateway/v1",
      modelName: "jev-1.13.0",
      numCtx: 32000,
    };
    const saved = await registerCustomEndpoint(input);
    expect(saved).not.toBeNull();
    if (!saved?.modelId) throw new Error("Missing registered model");
    const config = await llmProviderRepo.loadUserSavedProviderConfig(userId, saved.provider);
    expect(config?.llm_id).toBeNull();
    expect(saved.customEndpoint.is_default).toBe(false);
    expect(await llmModelRepo.loadAvailableModelsForProvider(saved.provider)).toEqual(null);
    const edited = await registerCustomEndpoint({
      ...input,
      modelName: "jev-latest",
      editingEndpointId: saved.customEndpoint.custom_endpoint_id,
    });
    expect(edited?.modelId).toBe(saved.modelId);
    expect(edited?.customEndpoint.custom_endpoint_id).toBe(saved.customEndpoint.custom_endpoint_id);
    const options = await llmModelRepo.loadDecisionModelOptions({ kind: "personal", ownerId: userId });
    const selected = options.find(
      (option) => option.reference.customEndpointId === saved.customEndpoint.custom_endpoint_id,
    );
    expect(selected?.model.codename).toBe("jev-latest");
    expect(selected?.reference).toMatchObject({
      provider: saved.provider,
      modelId: saved.modelId,
      registrationId: null,
    });
    if (!selected) throw new Error("Missing owned model option");
    const result = await callDecisionsForProvider({
      scope: { kind: "server", ownerId: serverId },
      reference: selected.reference,
      evidence: "fixture",
      questions: [{ type: "predicate", id: "criterion", instructions: "fixture" }],
    });
    expect(result).toMatchObject({ status: "unavailable", reason: "not-owned", errorLogged: false });
    expect(
      await llmProviderRepo.deleteOwnedDecisionRegistration(
        { kind: "server", ownerId: serverId },
        saved.provider,
        saved.modelId,
      ),
    ).toBe(false);
    expect(
      await llmProviderRepo.deleteOwnedDecisionRegistration(
        { kind: "personal", ownerId: userId },
        saved.provider,
        saved.modelId,
      ),
    ).toBe(true);
    expect(
      (await llmModelRepo.loadDecisionModelOptions({ kind: "personal", ownerId: userId })).some(
        (option) => option.reference.provider === saved.provider,
      ),
    ).toBe(false);
    expect(await llmProviderRepo.loadUserSavedProviderConfig(userId, saved.provider)).not.toBeNull();
    expect(
      await llmProviderRepo.deleteUserCustomEndpointConnectionGroup(userId, [saved.customEndpoint.connection_id]),
    ).toBe(true);
    expect(await llmProviderRepo.loadUserSavedProviderConfig(userId, saved.provider)).toBeNull();
  });

  it("preserves Decision registrations during reset and removes only the deleted native provider owner's references", async () => {
    const id = await llmModelRepo.upsertDecisionModel({
      provider: "openrouter",
      codename: "fixture-shared-owner",
      inputTokenLimit: 8192,
    });
    await llmProviderRepo.upsertDecisionModelRegistration({ serverId, decisionModelId: id });
    await llmProviderRepo.upsertDecisionModelRegistration({ userId, decisionModelId: id });
    await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version) VALUES (${serverId}, 'openrouter', ${Buffer.from("fixture")}, 1) ON CONFLICT (server_id, provider) DO NOTHING`;
    await resetRepository.resetServerConfiguration(serverId);
    expect(
      (await llmModelRepo.loadDecisionModelOptions({ kind: "server", ownerId: serverId })).some(
        (option) => option.reference.modelId === id,
      ),
    ).toBe(true);
    expect(await llmProviderRepo.deleteServerProviderRegistration(serverId, "openrouter")).toBe(true);
    expect(
      (await llmModelRepo.loadAvailableDecisionModels("openrouter", false, { kind: "server", ownerId: serverId })).some(
        (model) => model.decision_model_id === id,
      ),
    ).toBe(false);
    expect(
      (await llmModelRepo.loadAvailableDecisionModels("openrouter", false, { kind: "personal", ownerId: userId })).some(
        (model) => model.decision_model_id === id,
      ),
    ).toBe(true);
    await llmProviderRepo.deleteDecisionModelRegistration({ userId, decisionModelId: id });
    await llmModelRepo.deleteOrphanedDecisionModel(id);
  });

  it("rejects chat styles and undocumented input limits without persisting decision models", async () => {
    for (const apiStyle of ["openai-compatible", "ollama-native"] as const) {
      expect(
        await registerCustomEndpoint({
          scope: { kind: "personal", ownerId: userId, baseConfig: createServerConfig() },
          label: "fixture-invalid",
          capability: "decision",
          apiStyle,
          endpointUrl: "https://example.invalid/v1",
          modelName: "fixture",
          numCtx: 8192,
        }),
      ).toBeNull();
    }
    expect(
      await llmModelRepo
        .upsertDecisionModel({ provider: "openrouter", codename: "fixture-invalid", inputTokenLimit: Number.NaN })
        .catch(() => null),
    ).toBeNull();
    expect(await llmModelRepo.loadDecisionModelByProviderAndCodename("openrouter", "fixture-invalid")).toBeNull();
  });

  it("executes through exact server and personal credentials using a local fake transport", async () => {
    const calls: Array<{ authorization: string | null; model: unknown; path: string }> = [];
    const transport = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const body = (await request.json()) as { model: unknown };
        calls.push({
          authorization: request.headers.get("authorization"),
          model: body.model,
          path: new URL(request.url).pathname,
        });
        return Response.json({ model: "fixture-version", answers: { criterion: { type: "noul", noul: 0.8 } } });
      },
    });
    try {
      for (const scope of [
        { kind: "server" as const, ownerId: serverId, baseConfig: createServerConfig() },
        { kind: "personal" as const, ownerId: userId, baseConfig: createServerConfig() },
      ]) {
        const saved = await registerCustomEndpoint({
          scope,
          label: "fixture-credentials",
          capability: "decision",
          apiStyle: "system-one",
          endpointUrl: `http://localhost:${transport.port}/gateway/v1`,
          modelName: `${scope.kind}-decision`,
          numCtx: 8192,
          authToken: `${scope.kind}-fixture-key`,
        });
        if (!saved?.modelId) throw new Error("Missing credential fixture registration");
        const selected = (await llmModelRepo.loadDecisionModelOptions(scope)).find(
          (option) => option.reference.modelId === saved.modelId,
        );
        if (!selected) throw new Error("Missing credential fixture option");
        const result = await callDecisionsForProvider({
          scope,
          reference: selected.reference,
          evidence: "fixture",
          questions: [{ type: "predicate", id: "criterion", instructions: "fixture" }],
        });
        expect(result.status).toBe("completed");
        expect(calls.at(-1)).toEqual({
          authorization: `Bearer ${scope.kind}-fixture-key`,
          model: `${scope.kind}-decision`,
          path: "/gateway/v1/systemone",
        });
        const deleted =
          scope.kind === "server"
            ? await llmProviderRepo.deleteServerCustomEndpointConnectionGroup(serverId, [
                saved.customEndpoint.connection_id,
              ])
            : await llmProviderRepo.deleteUserCustomEndpointConnectionGroup(userId, [
                saved.customEndpoint.connection_id,
              ]);
        expect(deleted).toBe(true);
      }
    } finally {
      transport.stop(true);
    }
  });
});
