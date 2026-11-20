import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { setHostedTranscriptionSelection } from "@/utils/db/repositories/SpeechRepository";
import { resolveTranscriptionTargets } from "@/utils/provider/speechEndpointResolver";
import { activateProviderTranscriptionDefault } from "@/utils/provider/providerActivation";
import { encryptApiKey } from "@/utils/security/crypto";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";
import { insertFixtures, cleanupFixtures, type FixtureRefs } from "./setup/fixtures";

describe.skipIf(!DB_TESTS_AVAILABLE)("Hosted transcription persistence", () => {
  let refs: FixtureRefs;
  let googleId: number;
  let openRouterId: number;
  const server = () => ({ kind: "server" as const, ownerId: refs.serverId });
  const personal = () => ({ kind: "personal" as const, ownerId: refs.userId });

  async function saveKeys(provider: string): Promise<void> {
    const serverKey = await encryptApiKey(`test-server-${provider}-stt`);
    const personalKey = await encryptApiKey(`test-personal-${provider}-stt`);
    await testSql`
      INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version)
      VALUES (${refs.serverId}, ${provider}, ${serverKey.encrypted}, ${serverKey.version})
      ON CONFLICT (server_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, key_version = EXCLUDED.key_version
    `;
    await testSql`
      INSERT INTO user_saved_provider_configs (user_id, provider, api_key, key_version)
      VALUES (${refs.userId}, ${provider}, ${personalKey.encrypted}, ${personalKey.version})
      ON CONFLICT (user_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, key_version = EXCLUDED.key_version
    `;
  }

  async function serverSelection(): Promise<number | null> {
    const [row] =
      await testSql`SELECT transcription_model_id FROM server_speech_configs WHERE server_id = ${refs.serverId}`;
    return row?.transcription_model_id ?? null;
  }

  async function insertTranscriptionEndpoint(isDefault: boolean): Promise<number> {
    const [connection] = await testSql`
      INSERT INTO custom_endpoint_connections (server_id, label, capability, api_style, endpoint_url)
      VALUES (${refs.serverId}, ${`_rt_stt_${Date.now()}`}, 'transcription', 'openai-compatible-transcription', 'http://127.0.0.1:9')
      RETURNING connection_id
    `;
    const [endpoint] = await testSql`
      INSERT INTO custom_endpoints (connection_id, is_default) VALUES (${connection.connection_id}, ${isDefault})
      RETURNING custom_endpoint_id
    `;
    return endpoint.custom_endpoint_id;
  }

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    googleId =
      (await llmModelRepo.loadAvailableTranscriptionModels("google", server())).find((model) => model.is_default)
        ?.transcription_model_id ?? 0;
    openRouterId =
      (await llmModelRepo.loadAvailableTranscriptionModels("openrouter", server())).find((model) => model.is_default)
        ?.transcription_model_id ?? 0;
  });

  beforeEach(async () => {
    await testSql`DELETE FROM saved_provider_configs WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM user_saved_provider_configs WHERE user_id = ${refs.userId}`;
    await testSql`DELETE FROM custom_endpoint_connections WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM server_byok_configs WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM user_personalization_configs WHERE user_id = ${refs.userId}`;
    await saveKeys("google");
    await saveKeys("openrouter");
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
    await testSql`DELETE FROM transcription_models WHERE codename LIKE '_rt/%'`;
  });

  it("seeds one default per hosted provider", async () => {
    for (const provider of ["google", "vertex", "openrouter"]) {
      const defaults = (await llmModelRepo.loadAvailableTranscriptionModels(provider, server())).filter(
        (model) => model.is_default,
      );
      expect(defaults).toHaveLength(1);
    }
  });

  it("requires a saved server key and clears the selection when that key is removed", async () => {
    await testSql`DELETE FROM saved_provider_configs WHERE server_id = ${refs.serverId} AND provider = 'google'`;
    expect(await setHostedTranscriptionSelection(server(), googleId)).toBe(false);
    await saveKeys("google");
    expect(await setHostedTranscriptionSelection(server(), googleId)).toBe(true);
    expect(await serverSelection()).toBe(googleId);
    await testSql`DELETE FROM saved_provider_configs WHERE server_id = ${refs.serverId} AND provider = 'google'`;
    expect(await serverSelection()).toBeNull();
  });

  it("keeps a hosted model and a default endpoint mutually exclusive", async () => {
    const endpointId = await insertTranscriptionEndpoint(true);
    expect(await setHostedTranscriptionSelection(server(), googleId)).toBe(true);
    const [endpoint] = await testSql`SELECT is_default FROM custom_endpoints WHERE custom_endpoint_id = ${endpointId}`;
    expect(endpoint.is_default).toBe(false);
    expect(
      await llmProviderRepo.setActiveCustomEndpoint({
        serverId: refs.serverId,
        capability: "transcription",
        customEndpointId: endpointId,
      }),
    ).toBe(true);
    expect(await serverSelection()).toBeNull();
  });

  it("turns server transcription off when clearing a default endpoint", async () => {
    await insertTranscriptionEndpoint(true);
    expect((await resolveTranscriptionTargets(refs.serverId)).map((target) => target.kind)).toEqual([
      "custom-endpoint",
    ]);
    expect(await setHostedTranscriptionSelection(server(), null)).toBe(true);
    expect(await serverSelection()).toBeNull();
    expect(await resolveTranscriptionTargets(refs.serverId)).toEqual([]);
  });

  it("fills only an empty slot when a provider is added", async () => {
    const endpointId = await insertTranscriptionEndpoint(true);
    expect(await activateProviderTranscriptionDefault(server(), "google")).toBe(true);
    expect(await serverSelection()).toBeNull();
    await testSql`DELETE FROM custom_endpoints WHERE custom_endpoint_id = ${endpointId}`;
    expect(await activateProviderTranscriptionDefault(server(), "google")).toBe(true);
    expect(await serverSelection()).toBe(googleId);
  });

  it("keeps the personal model through an unrelated saved-config write and clears it with the key", async () => {
    expect(await setHostedTranscriptionSelection(personal(), googleId)).toBe(true);
    const saved = await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "google");
    if (!saved) throw new Error("personal google row missing");
    expect(await llmProviderRepo.upsertUserSavedProviderConfig(refs.userId, { ...saved, llm_temperature: 0.5 })).toBe(
      true,
    );
    let [row] = await testSql`
      SELECT transcription_model_id, enabled_capabilities FROM user_saved_provider_configs
      WHERE user_id = ${refs.userId} AND provider = 'google'
    `;
    expect(row.transcription_model_id).toBe(googleId);
    expect(row.enabled_capabilities).toContain("transcription");
    await testSql`UPDATE user_saved_provider_configs SET api_key = NULL WHERE user_id = ${refs.userId} AND provider = 'google'`;
    [row] = await testSql`
      SELECT transcription_model_id, enabled_capabilities, assigned_capabilities FROM user_saved_provider_configs
      WHERE user_id = ${refs.userId} AND provider = 'google'
    `;
    expect(row.transcription_model_id).toBeNull();
    expect(row.enabled_capabilities).not.toContain("transcription");
    expect(row.assigned_capabilities).not.toContain("transcription");
  });

  it("moves personal ownership to the newly selected provider", async () => {
    expect(await setHostedTranscriptionSelection(personal(), googleId)).toBe(true);
    expect(await setHostedTranscriptionSelection(personal(), openRouterId)).toBe(true);
    const owners = await testSql`
      SELECT provider FROM user_saved_provider_configs
      WHERE user_id = ${refs.userId} AND 'transcription' = ANY(assigned_capabilities)
    `;
    expect(owners.map(({ provider }: { provider: string }) => provider)).toEqual(["openrouter"]);
  });

  it("clears a scoped selection when its registration is removed", async () => {
    const scoped = await llmModelRepo.ensureTranscriptionModel("openrouter", "_rt/scoped-stt");
    expect(scoped.is_scoped_registration).toBe(true);
    expect(await setHostedTranscriptionSelection(server(), scoped.transcription_model_id, { register: true })).toBe(
      true,
    );
    expect(await serverSelection()).toBe(scoped.transcription_model_id);
    await testSql`
      DELETE FROM scoped_model_registrations
      WHERE server_id = ${refs.serverId} AND transcription_model_id = ${scoped.transcription_model_id}
    `;
    expect(await serverSelection()).toBeNull();
  });

  it("orders the sender's personal model before the server's and honors routing policy", async () => {
    expect(await setHostedTranscriptionSelection(server(), googleId)).toBe(true);
    expect(await setHostedTranscriptionSelection(personal(), openRouterId)).toBe(true);
    const owners = async () =>
      (await resolveTranscriptionTargets(refs.serverId, refs.userId)).map((target) =>
        target.kind === "hosted-model" ? target.owner.kind : target.kind,
      );
    expect(await owners()).toEqual(["personal", "server"]);
    expect((await resolveTranscriptionTargets(refs.serverId)).map((target) => target.kind)).toEqual(["hosted-model"]);

    await testSql`
      INSERT INTO user_personalization_configs (user_id, personal_server_fallback_enabled)
      VALUES (${refs.userId}, false)
      ON CONFLICT (user_id) DO UPDATE SET personal_server_fallback_enabled = false
    `;
    expect(await owners()).toEqual(["personal"]);

    await testSql`DELETE FROM user_personalization_configs WHERE user_id = ${refs.userId}`;
    await testSql`
      INSERT INTO server_byok_configs (server_id, user_byok_mode) VALUES (${refs.serverId}, true)
      ON CONFLICT (server_id) DO UPDATE SET user_byok_mode = true
    `;
    expect(await owners()).toEqual(["personal"]);
    await testSql`
      UPDATE user_saved_provider_configs SET enabled_capabilities = array_remove(enabled_capabilities, 'transcription')
      WHERE user_id = ${refs.userId}
    `;
    expect(await owners()).toEqual([]);
  });
});
