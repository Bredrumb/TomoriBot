import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  API_KEY_OWNERS,
  clearInactiveApiKeys,
  loadCredentialActivityReferences,
  recordCredentialRequestAttempt,
} from "@/utils/db/repositories/ApiKeyRetentionRepository";
import { llmProviderRepo } from "@/utils/db/repositories/LlmProviderRepository";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { createCredentialActivityFetch } from "@/utils/provider/providerRequestHook";
import { withProviderUsageContext, type ProviderUsageContext } from "@/utils/provider/providerUsage";
import { keyManager } from "@/utils/security/keyManager";
import { rotateEncryptedRow } from "@/utils/security/encryptedColumns";
import { cache } from "@/utils/cache/tomoriStateCacheStore";
import { createPersona } from "../../helpers/fixtures";
import { useFullEnvSandbox } from "../../helpers/env";
import { cleanupFixtures, insertFixtures, FIXTURE_IDS, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql, executeTestSqlFile } from "./setup/testDb";

const MASTER_V1 = "synthetic_retention_master_key_version_one";
const MASTER_V2 = "synthetic_retention_master_key_version_two";
const KEY = "synthetic_provider_credential_for_retention";

describe.skipIf(!DB_TESTS_AVAILABLE)("stored API key retention", () => {
  useFullEnvSandbox();
  let fixture: FixtureRefs;
  let modelId: number;

  beforeAll(async () => {
    await setupTestDb();
    fixture = await insertFixtures(testSql);
    const [model] = await testSql`SELECT llm_id FROM llms WHERE llm_provider = 'google' LIMIT 1`;
    modelId = model.llm_id;
  });

  beforeEach(async () => {
    for (const name of Object.keys(process.env)) if (name.startsWith("CRYPTO_SECRET")) delete process.env[name];
    Object.assign(process.env, {
      CRYPTO_SECRET_V1: MASTER_V1,
      CRYPTO_SECRET_V2: MASTER_V2,
      CRYPTO_SECRET_CURRENT: "1",
    });
    keyManager.initialize();
    await testSql`DELETE FROM saved_provider_configs WHERE server_id = ${fixture.serverId}`;
    await testSql`DELETE FROM user_saved_provider_configs WHERE user_id = ${fixture.userId}`;
    await testSql`DELETE FROM api_key_rotation WHERE server_id = ${fixture.serverId}`;
    await testSql`DELETE FROM opt_api_keys WHERE server_id = ${fixture.serverId}`;
    await testSql`UPDATE server_model_configs SET api_key = NULL, llm_id = ${modelId} WHERE server_id = ${fixture.serverId}`;
    cache.clear();
  });

  afterAll(async () => {
    cache.clear();
    await cleanupFixtures(testSql);
  });

  async function encrypt(value = KEY): Promise<Buffer> {
    const [row] = await testSql`SELECT pgp_sym_encrypt(${value}, ${MASTER_V1}) AS ciphertext`;
    return row.ciphertext;
  }

  async function save(ciphertext: Buffer) {
    const [row] = await testSql`
      INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version, llm_id, llm_temperature)
      VALUES (${fixture.serverId}, 'google', ${ciphertext}, 1, ${modelId}, 0.7)
      RETURNING *
    `;
    return row;
  }

  async function age(table: string): Promise<void> {
    const column = table === "user_saved_provider_configs" ? "user_id" : "server_id";
    const ownerId = table === "user_saved_provider_configs" ? fixture.userId : fixture.serverId;
    await testSql`UPDATE ${testSql(table)} SET credential_created_at = clock_timestamp() - INTERVAL '91 days',
      credential_last_attempt_at = NULL WHERE ${testSql(column)} = ${ownerId}`;
  }

  async function context(ciphertext: Buffer): Promise<ProviderUsageContext> {
    return {
      storedCredentialActivity: {
        references: await loadCredentialActivityReferences(ciphertext, testSql),
        requestKeyDigest: createHash("sha256").update(KEY).digest("hex"),
      },
    };
  }

  it("gives never-used credentials a grace period and clears expired material while preserving settings", async () => {
    const ciphertext = await encrypt();
    const saved = await save(ciphertext);
    await testSql`INSERT INTO speech_voice_bindings (persona_id, saved_config_id, credential_revision, transport, prompt_hash, voice_id)
      VALUES (${fixture.personaId}, ${saved.saved_config_id}, ${saved.credential_revision}, 'google', 'synthetic_prompt_hash', 'voice_retention')`;
    await testSql`UPDATE saved_provider_configs SET updated_at = clock_timestamp() - INTERVAL '200 days' WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(await clearInactiveApiKeys(90, testSql)).toHaveLength(0);
    await testSql`UPDATE server_model_configs SET api_key = ${ciphertext} WHERE server_id = ${fixture.serverId}`;
    await testSql`INSERT INTO api_key_rotation (server_id, provider, is_main_key_pointer) VALUES (${fixture.serverId}, 'google', true)`;
    await age("saved_provider_configs");
    cache.set(FIXTURE_IDS.serverDiscId, {
      mainPersona: createPersona({ server_id: fixture.serverId }),
      personas: [],
      cachedAt: Date.now(),
    });
    const retired = await clearInactiveApiKeys(90, testSql);
    expect(
      retired.some((entry) => entry.id === saved.saved_config_id && entry.table === "saved_provider_configs"),
    ).toBe(true);
    const [stored] =
      await testSql`SELECT api_key, llm_id, llm_temperature FROM saved_provider_configs WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(stored.api_key).toBeNull();
    expect(stored.llm_id).toBe(modelId);
    expect(stored.llm_temperature).toBeCloseTo(0.7);
    const [binding] =
      await testSql`SELECT pending_delete FROM speech_voice_bindings WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(binding.pending_delete).toBe(true);
    const [mirror] = await testSql`SELECT api_key FROM server_model_configs WHERE server_id = ${fixture.serverId}`;
    expect(mirror.api_key).toBeNull();
    expect(
      await testSql`SELECT 1 FROM api_key_rotation WHERE server_id = ${fixture.serverId} AND is_main_key_pointer`,
    ).toHaveLength(0);
    expect(cache.has(FIXTURE_IDS.serverDiscId)).toBe(false);
    expect(await clearInactiveApiKeys(90, testSql)).toHaveLength(0);
  });

  it("records failed authenticated dispatches for every credential owner", async () => {
    const entries: Array<{ table: string; ciphertext: Buffer; updatedAt: Date }> = [];
    for (const owner of API_KEY_OWNERS) {
      const ciphertext = await encrypt();
      if (owner.table === "saved_provider_configs") await save(ciphertext);
      else if (owner.table === "user_saved_provider_configs") {
        await testSql`INSERT INTO user_saved_provider_configs (user_id, provider, api_key, key_version)
          VALUES (${fixture.userId}, 'google', ${ciphertext}, 1)`;
      } else if (owner.table === "api_key_rotation") {
        await testSql`INSERT INTO api_key_rotation (server_id, provider, api_key, key_version)
          VALUES (${fixture.serverId}, 'google', ${ciphertext}, 1)`;
      } else if (owner.table === "opt_api_keys") {
        await testSql`INSERT INTO opt_api_keys (server_id, service_name, api_key, key_version)
          VALUES (${fixture.serverId}, 'brave-search', ${ciphertext}, 1)`;
      } else
        await testSql`UPDATE server_model_configs SET api_key = ${ciphertext} WHERE server_id = ${fixture.serverId}`;
      await age(owner.table);
      const [stored] = await testSql`SELECT updated_at FROM ${testSql(owner.table)} WHERE api_key = ${ciphertext}`;
      entries.push({ table: owner.table, ciphertext, updatedAt: stored.updated_at });
    }
    let dispatched = 0;
    const fetcher = createCredentialActivityFetch(
      Object.assign(
        async () => {
          dispatched++;
          return new Response(null, { status: 429 });
        },
        { preconnect: fetch.preconnect },
      ) as typeof fetch,
    );
    for (const [index, entry] of entries.entries()) {
      const headers = ["authorization", "x-goog-api-key", "x-api-key", "x-subscription-token"][index];
      const response = await withProviderUsageContext(await context(entry.ciphertext), () =>
        fetcher(index === 4 ? `https://example.com/request?key=${KEY}` : "https://example.com/request", {
          headers: headers ? { [headers]: headers === "authorization" ? `Bearer ${KEY}` : KEY } : undefined,
        }),
      );
      expect(response.status).toBe(429);
      const [stored] =
        await testSql`SELECT credential_last_attempt_at, updated_at FROM ${testSql(entry.table)} WHERE api_key = ${entry.ciphertext}`;
      expect(stored.credential_last_attempt_at).toBeInstanceOf(Date);
      expect(stored.updated_at.getTime()).toBe(entry.updatedAt.getTime());
    }
    expect(dispatched).toBe(entries.length);
    expect(await clearInactiveApiKeys(90, testSql)).toHaveLength(0);
  });

  it("promotes an active rotation member when the primary expires without resetting its inactivity age", async () => {
    const original = await encrypt();
    const saved = await save(original);
    await testSql`UPDATE server_model_configs SET api_key = ${original} WHERE server_id = ${fixture.serverId}`;
    await age("saved_provider_configs");
    const replacement = await encrypt("synthetic_active_rotation_member");
    const [pointer] = await testSql`INSERT INTO api_key_rotation (server_id, provider, is_main_key_pointer)
      VALUES (${fixture.serverId}, 'google', true) RETURNING rotation_key_id`;
    const [member] = await testSql`INSERT INTO api_key_rotation (server_id, provider, api_key, key_version,
      credential_created_at, credential_last_attempt_at)
      VALUES (${fixture.serverId}, 'google', ${replacement}, 1, clock_timestamp() - INTERVAL '100 days', clock_timestamp())
      RETURNING rotation_key_id, credential_created_at, credential_last_attempt_at`;
    await clearInactiveApiKeys(90, testSql);
    const [primary] =
      await testSql`SELECT * FROM saved_provider_configs WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(primary.api_key.equals(replacement)).toBe(true);
    expect(primary.key_version).toBe(1);
    expect(primary.credential_revision).toBe(saved.credential_revision + 1);
    expect(primary.credential_created_at.getTime()).toBe(member.credential_created_at.getTime());
    expect(primary.credential_last_attempt_at.getTime()).toBe(member.credential_last_attempt_at.getTime());
    const [promoted] =
      await testSql`SELECT api_key, is_main_key_pointer FROM api_key_rotation WHERE rotation_key_id = ${member.rotation_key_id}`;
    expect(promoted.is_main_key_pointer).toBe(true);
    expect(promoted.api_key).toBeNull();
    expect(
      await testSql`SELECT 1 FROM api_key_rotation WHERE rotation_key_id = ${pointer.rotation_key_id}`,
    ).toHaveLength(0);
    expect((await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.api_key?.equals(replacement)).toBe(
      true,
    );
    expect(await clearInactiveApiKeys(90, testSql)).toHaveLength(0);
  });

  it("defers primary expiry while the eligible pool member is locked", async () => {
    const original = await encrypt();
    const saved = await save(original);
    await age("saved_provider_configs");
    const replacement = await encrypt("synthetic_busy_rotation_member");
    const [member] = await testSql`INSERT INTO api_key_rotation (server_id, provider, api_key, key_version)
      VALUES (${fixture.serverId}, 'google', ${replacement}, 1) RETURNING rotation_key_id`;
    let unlock!: () => void;
    let locked!: () => void;
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = testSql
      .begin(async (tx) => {
        await tx`SELECT rotation_key_id FROM api_key_rotation WHERE rotation_key_id = ${member.rotation_key_id} FOR UPDATE`;
        locked();
        await release;
      })
      .then(() => undefined);
    await ready;
    try {
      expect(await clearInactiveApiKeys(90, testSql)).toHaveLength(0);
    } finally {
      unlock();
    }
    await hold;
    const [unchanged] =
      await testSql`SELECT api_key FROM saved_provider_configs WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(unchanged.api_key.equals(original)).toBe(true);
    await clearInactiveApiKeys(90, testSql);
    const [promoted] =
      await testSql`SELECT api_key FROM saved_provider_configs WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(promoted.api_key.equals(replacement)).toBe(true);
  });

  it("does not refresh activity for anonymous requests or local cancellation and refuses a stale generation", async () => {
    const ciphertext = await encrypt();
    const saved = await save(ciphertext);
    const usage = await context(ciphertext);
    let dispatched = 0;
    const fetcher = createCredentialActivityFetch(
      Object.assign(
        async () => {
          dispatched++;
          return new Response(null, { status: 200 });
        },
        { preconnect: fetch.preconnect },
      ) as typeof fetch,
    );
    await withProviderUsageContext(usage, () => fetcher("https://example.com/anonymous"));
    await expect(
      withProviderUsageContext(usage, () =>
        fetcher("https://example.com/request", {
          headers: { Authorization: `Bearer ${KEY}` },
          signal: AbortSignal.abort(),
        }),
      ),
    ).rejects.toBeInstanceOf(Error);
    const [unused] =
      await testSql`SELECT credential_last_attempt_at FROM saved_provider_configs WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(unused.credential_last_attempt_at).toBeNull();
    await testSql`UPDATE saved_provider_configs SET api_key = ${await encrypt("synthetic_replacement")} WHERE saved_config_id = ${saved.saved_config_id}`;
    await expect(
      withProviderUsageContext(usage, () =>
        fetcher("https://example.com/request", {
          headers: { Authorization: `Bearer ${KEY}` },
        }),
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(dispatched).toBe(1);
    const [replacement] =
      await testSql`SELECT credential_last_attempt_at FROM saved_provider_configs WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(replacement.credential_last_attempt_at).toBeNull();
  });

  it("protects a request before its slow or failed provider response arrives", async () => {
    const ciphertext = await encrypt();
    await save(ciphertext);
    await age("saved_provider_configs");
    let release!: (response: Response) => void;
    let sent!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      sent = resolve;
    });
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetcher = createCredentialActivityFetch(
      Object.assign(
        () => {
          sent();
          return response;
        },
        { preconnect: fetch.preconnect },
      ) as typeof fetch,
    );
    const pending = withProviderUsageContext(await context(ciphertext), () =>
      fetcher("https://example.com/request", {
        headers: { Authorization: `Bearer ${KEY}` },
      }),
    );
    await dispatched;
    expect(await clearInactiveApiKeys(90, testSql)).toHaveLength(0);
    release(new Response(null, { status: 401 }));
    expect((await pending).status).toBe(401);
  });

  it("keeps maintenance and same-key settings edits from resetting age or credential revisions", async () => {
    const ciphertext = await encrypt();
    const saved = await save(ciphertext);
    await age("saved_provider_configs");
    const [before] =
      await testSql`SELECT * FROM saved_provider_configs WHERE saved_config_id = ${saved.saved_config_id}`;
    const config = await llmProviderRepo.loadSavedProviderConfig(fixture.serverId, "google");
    if (!config) throw new Error("Saved provider fixture missing");
    expect(
      await llmProviderRepo.upsertSavedProviderConfig(fixture.serverId, {
        ...config,
        api_key: await encrypt(),
        key_version: 1,
        thinking_level: "auto",
      }),
    ).toBe(true);
    process.env.CRYPTO_SECRET_CURRENT = "2";
    keyManager.initialize();
    await rotateEncryptedRow(
      testSql,
      { table: "saved_provider_configs", id: "saved_config_id", column: "api_key" },
      {
        id: saved.saved_config_id,
        ciphertext,
        key_version: 1,
      },
    );
    const [after] =
      await testSql`SELECT * FROM saved_provider_configs WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(after.credential_revision).toBe(before.credential_revision);
    expect(after.credential_created_at.getTime()).toBe(before.credential_created_at.getTime());
    expect(after.key_version).toBe(2);
    expect((await clearInactiveApiKeys(90, testSql)).some((entry) => entry.id === saved.saved_config_id)).toBe(true);
    await expect(
      recordCredentialRequestAttempt(await loadCredentialActivityReferences(ciphertext, testSql), testSql),
    ).rejects.toBeInstanceOf(Error);
  });

  it("checks the expiry boundary and leaves fresh replacements available", async () => {
    const saved = await save(await encrypt());
    await testSql`UPDATE saved_provider_configs SET credential_created_at = clock_timestamp() - INTERVAL '90 days' + INTERVAL '5 seconds'
      WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(await clearInactiveApiKeys(90, testSql)).toHaveLength(0);
    await testSql`UPDATE saved_provider_configs SET credential_created_at = clock_timestamp() - INTERVAL '90 days'
      WHERE saved_config_id = ${saved.saved_config_id}`;
    expect((await clearInactiveApiKeys(90, testSql)).some((entry) => entry.id === saved.saved_config_id)).toBe(true);
    await testSql`UPDATE saved_provider_configs SET api_key = ${await encrypt("synthetic_new_generation")} WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(await clearInactiveApiKeys(90, testSql)).toHaveLength(0);
  });

  it("skips a locked dispatch and rejects an attempt queued behind replacement", async () => {
    const ciphertext = await encrypt();
    const saved = await save(ciphertext);
    await age("saved_provider_configs");
    const references = await loadCredentialActivityReferences(ciphertext, testSql);
    let unlock!: () => void;
    let locked!: () => void;
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const replacementCiphertext = await encrypt("synthetic_concurrent_replacement");
    const replacement = testSql
      .begin(async (tx) => {
        await tx`UPDATE saved_provider_configs SET api_key = ${replacementCiphertext} WHERE saved_config_id = ${saved.saved_config_id}`;
        locked();
        await release;
      })
      .then(() => undefined);
    await ready;
    const attempt = recordCredentialRequestAttempt(references, testSql).then(
      () => false,
      () => true,
    );
    try {
      expect(await clearInactiveApiKeys(90, testSql)).toHaveLength(0);
    } finally {
      unlock();
    }
    await replacement;
    expect(await attempt).toBe(true);
    const [stored] =
      await testSql`SELECT api_key, credential_last_attempt_at FROM saved_provider_configs WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(stored.api_key.equals(replacementCiphertext)).toBe(true);
    expect(stored.credential_last_attempt_at).toBeNull();
  });

  it("refuses transport on activity-write failure and invalidates caches only after successful cleanup", async () => {
    const ciphertext = await encrypt();
    const saved = await save(ciphertext);
    await age("saved_provider_configs");
    cache.set(FIXTURE_IDS.serverDiscId, {
      mainPersona: createPersona({ server_id: fixture.serverId }),
      personas: [],
      cachedAt: Date.now(),
    });
    await testSql`CREATE FUNCTION _rt_retention_reject_write() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Synthetic write failure'; END; $$ LANGUAGE plpgsql`;
    await testSql`CREATE TRIGGER _rt_retention_reject_write BEFORE UPDATE ON saved_provider_configs
      FOR EACH ROW EXECUTE FUNCTION _rt_retention_reject_write()`;
    let dispatched = false;
    const fetcher = createCredentialActivityFetch(
      Object.assign(
        async () => {
          dispatched = true;
          return new Response();
        },
        { preconnect: fetch.preconnect },
      ) as typeof fetch,
    );
    try {
      await expect(
        withProviderUsageContext(await context(ciphertext), () =>
          fetcher("https://example.com/request", {
            headers: { Authorization: `Bearer ${KEY}` },
          }),
        ),
      ).rejects.toBeInstanceOf(Error);
      expect(dispatched).toBe(false);
      await expect(clearInactiveApiKeys(90, testSql)).rejects.toBeInstanceOf(Error);
      expect(cache.has(FIXTURE_IDS.serverDiscId)).toBe(true);
      const [stored] =
        await testSql`SELECT api_key FROM saved_provider_configs WHERE saved_config_id = ${saved.saved_config_id}`;
      expect(stored.api_key.equals(ciphertext)).toBe(true);
    } finally {
      await testSql`DROP TRIGGER _rt_retention_reject_write ON saved_provider_configs`;
      await testSql`DROP FUNCTION _rt_retention_reject_write()`;
    }
    await clearInactiveApiKeys(90, testSql);
    expect(cache.has(FIXTURE_IDS.serverDiscId)).toBe(false);
  });

  it("migrates legacy-only active keys once and reads canonical credentials without reviving a cleared key", async () => {
    const ciphertext = await encrypt();
    await testSql`UPDATE server_model_configs SET api_key = ${ciphertext}, key_version = 1 WHERE server_id = ${fixture.serverId}`;
    await executeTestSqlFile("src/db/migrations/139_api_key_activity.sql");
    const [saved] =
      await testSql`SELECT * FROM saved_provider_configs WHERE server_id = ${fixture.serverId} AND provider = 'google'`;
    expect(saved.api_key.equals(ciphertext)).toBe(true);
    expect(saved.credential_last_attempt_at).toBeNull();
    const [grace] = await testSql`SELECT credential_created_at > clock_timestamp() - INTERVAL '1 minute' AS fresh
      FROM saved_provider_configs WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(grace.fresh).toBe(true);
    await testSql`UPDATE server_model_configs SET api_key = ${await encrypt("synthetic_stale_mirror")} WHERE server_id = ${fixture.serverId}`;
    const primary = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    const personas = await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId);
    expect(primary?.config.api_key?.equals(ciphertext)).toBe(true);
    expect(
      personas.find((persona) => persona.persona_id === fixture.personaId)?.config.api_key?.equals(ciphertext),
    ).toBe(true);
    await testSql`UPDATE saved_provider_configs SET api_key = NULL WHERE saved_config_id = ${saved.saved_config_id}`;
    await executeTestSqlFile("src/db/migrations/139_api_key_activity.sql");
    expect((await personaRepository.loadState(FIXTURE_IDS.serverDiscId))?.config.api_key).toBeNull();
    await executeTestSqlFile("src/db/migrations/139_api_key_activity.down.sql");
    await executeTestSqlFile("src/db/migrations/139_api_key_activity.sql");
    const [restored] =
      await testSql`SELECT api_key FROM saved_provider_configs WHERE saved_config_id = ${saved.saved_config_id}`;
    expect(restored.api_key).toBeNull();
  });
});
