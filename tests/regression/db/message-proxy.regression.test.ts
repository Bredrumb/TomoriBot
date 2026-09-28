import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ProxyIdentityUpsertInput } from "@/utils/messageProxy/types";
import { getCachedUserRow } from "@/utils/cache/userCache";
import { persistMessageProxyAttestationIdentity } from "@/utils/messageProxy/persistence";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";
import { exportRepository } from "@/utils/db/repositories/ExportRepository";
import { importRepository } from "@/utils/db/repositories/ImportRepository";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const PRIMARY_KEY = "11111111-2222-4333-8444-555555555555";
const SECONDARY_KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ROLLBACK_KEY = "99999999-8888-4777-8666-555555555555";
const CASCADE_KEY = "12345678-1234-4234-8234-123456789abc";

function identityInput(
  externalKey = PRIMARY_KEY,
  overrides: Partial<ProxyIdentityUpsertInput> = {},
): ProxyIdentityUpsertInput {
  return {
    serviceId: "pluralkit",
    externalIdentityKind: "pluralkit_member",
    externalKey,
    shortId: "sparrow",
    displayName: "Sparrow",
    bio: "Keeps field notes.",
    namespace: {
      namespaceKey: "fixture-account",
      shortId: "light",
      displayName: "Lighthouse",
      tag: "[LH]",
      description: "An archival collective.",
    },
    ...overrides,
  };
}

async function cleanup(): Promise<void> {
  await testSql`
    DELETE FROM users
    WHERE user_disc_id IN (
      ${`pk:${PRIMARY_KEY}`}, ${`pk:${SECONDARY_KEY}`}, ${`pk:${ROLLBACK_KEY}`},
      ${`pk:${CASCADE_KEY}`}, '_rt_message_proxy_settings'
    )
  `;
  await testSql`
    DELETE FROM message_proxy_namespaces
    WHERE service_id = 'pluralkit'
      AND namespace_key IN ('fixture-account', 'rollback-account', 'cascade-account')
  `;
}

describe.skipIf(!DB_TESTS_AVAILABLE)("message-proxy persistence regression", () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanup();
  });

  afterAll(cleanup);

  it("creates canonical identity state atomically and reloads it in one batch", async () => {
    expect(await messageProxyRepository.getIdentityContextByUserDiscId(`pk:${PRIMARY_KEY}`)).toBeNull();

    const result = await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(),
      messageDiscId: "_rt_proxy_message_1",
      senderDiscId: "_rt_proxy_host_1",
    });

    expect(result?.isNewIdentity).toBe(true);
    expect(result?.userRow.user_disc_id).toBe(`pk:${PRIMARY_KEY}`);
    const identities = await messageProxyRepository.getMessageIdentitiesByMessageIds([
      "_rt_proxy_message_1",
      "_rt_missing_message",
    ]);
    expect(identities?.get("_rt_proxy_message_1")).toMatchObject({
      serviceId: "pluralkit",
      externalKey: PRIMARY_KEY,
      senderDiscId: "_rt_proxy_host_1",
      namespaceKey: "fixture-account",
    });
    expect(identities?.has("_rt_missing_message")).toBe(false);
    expect(await messageProxyRepository.getIdentityContextByUserDiscId(`pk:${PRIMARY_KEY}`)).toMatchObject({
      externalKey: PRIMARY_KEY,
    });
    expect((await getCachedUserRow(`pk:${PRIMARY_KEY}`))?.user_nickname).toBe("Sparrow");
  });

  it("is idempotent, refreshes cosmetic names, and supports multiple hosts", async () => {
    const renamed = identityInput(PRIMARY_KEY, {
      displayName: "Sparrow Updated",
      namespace: {
        namespaceKey: "fixture-account",
        shortId: "light",
        displayName: "Lighthouse Updated",
        tag: "[NEW]",
        description: "Updated public description.",
      },
    });
    const result = await messageProxyRepository.persistAttestedIdentity({
      input: renamed,
      messageDiscId: "_rt_proxy_message_2",
      senderDiscId: "_rt_proxy_host_2",
    });

    expect(result?.isNewIdentity).toBe(false);
    expect(result?.userRow.user_nickname).toBe("Sparrow Updated");
    expect(result?.namespace).toMatchObject({
      display_name: "Lighthouse Updated",
      tag: "[NEW]",
      description: "Updated public description.",
    });
    expect((await getCachedUserRow(`pk:${PRIMARY_KEY}`))?.user_nickname).toBe("Sparrow Updated");
    const context = await messageProxyRepository.getIdentityContextByUserDiscId(`pk:${PRIMARY_KEY}`);
    expect(context?.hostUserDiscIds.sort()).toEqual(["_rt_proxy_host_1", "_rt_proxy_host_2"]);
  });

  it("keeps an existing message attribution immutable", async () => {
    await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(SECONDARY_KEY),
      messageDiscId: "_rt_proxy_message_1",
      senderDiscId: "_rt_proxy_host_other",
    });

    const identities = await messageProxyRepository.getMessageIdentitiesByMessageIds(["_rt_proxy_message_1"]);
    expect(identities?.get("_rt_proxy_message_1")).toMatchObject({
      externalKey: PRIMARY_KEY,
      senderDiscId: "_rt_proxy_host_1",
    });
  });

  it("rolls back user, namespace, and identity rows when a late write fails", async () => {
    const result = await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(ROLLBACK_KEY, {
        namespace: {
          namespaceKey: "rollback-account",
          shortId: null,
          displayName: "Rollback Account",
          tag: null,
          description: null,
        },
      }),
      messageDiscId: "_rt_proxy_message_rollback",
      senderDiscId: null as unknown as string,
    });

    expect(result).toBeNull();
    const [counts] = await testSql`
      SELECT
        (SELECT COUNT(*)::INT FROM users WHERE user_disc_id = ${`pk:${ROLLBACK_KEY}`}) AS users,
        (SELECT COUNT(*)::INT FROM message_proxy_namespaces WHERE namespace_key = 'rollback-account') AS namespaces,
        (SELECT COUNT(*)::INT FROM external_identities WHERE external_key = ${ROLLBACK_KEY}) AS identities,
        (SELECT COUNT(*)::INT FROM message_proxy_message_index WHERE message_disc_id = '_rt_proxy_message_rollback') AS messages
    `;
    expect(counts).toMatchObject({ users: 0, namespaces: 0, identities: 0, messages: 0 });
  });

  it("writes no canonical identity state for an identity-free attestation", async () => {
    const [before] = await testSql`
      SELECT
        (SELECT COUNT(*)::INT FROM external_identities) AS external_identities,
        (SELECT COUNT(*)::INT FROM message_proxy_namespaces) AS namespaces,
        (SELECT COUNT(*)::INT FROM message_proxy_identities) AS identities,
        (SELECT COUNT(*)::INT FROM message_proxy_namespace_accounts) AS accounts,
        (SELECT COUNT(*)::INT FROM message_proxy_message_index) AS messages
    `;

    expect(
      await persistMessageProxyAttestationIdentity({
        messageDiscId: "_rt_proxy_identity_free",
        serverDiscId: null,
        attestation: {
          serviceId: "pluralkit",
          proxyMessageId: "_rt_proxy_identity_free",
          originalMessageId: "_rt_proxy_original_identity_free",
          senderDiscordId: "_rt_proxy_host_identity_free",
          identity: null,
        },
      }),
    ).toBe("identity_free");

    const [after] = await testSql`
      SELECT
        (SELECT COUNT(*)::INT FROM external_identities) AS external_identities,
        (SELECT COUNT(*)::INT FROM message_proxy_namespaces) AS namespaces,
        (SELECT COUNT(*)::INT FROM message_proxy_identities) AS identities,
        (SELECT COUNT(*)::INT FROM message_proxy_namespace_accounts) AS accounts,
        (SELECT COUNT(*)::INT FROM message_proxy_message_index) AS messages
    `;
    expect(after).toEqual(before);
  });

  it("enforces namespace uniqueness and required lookup indexes", async () => {
    const [namespaceConstraint] = await testSql<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'message_proxy_namespaces_service_id_namespace_key_key'
    `;
    expect(namespaceConstraint?.definition).toBe("UNIQUE (service_id, namespace_key)");

    const indexes = await testSql<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_message_proxy_identities_namespace',
          'idx_message_proxy_namespace_accounts_host',
          'idx_message_proxy_message_index_created'
        )
      ORDER BY indexname
    `;
    expect(indexes.map((row) => row.indexname)).toEqual([
      "idx_message_proxy_identities_namespace",
      "idx_message_proxy_message_index_created",
      "idx_message_proxy_namespace_accounts_host",
    ]);
  });

  it("cascades synthetic-user deletion through identity and message attribution", async () => {
    await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(CASCADE_KEY, {
        namespace: {
          namespaceKey: "cascade-account",
          shortId: null,
          displayName: "Cascade Account",
          tag: null,
          description: null,
        },
      }),
      messageDiscId: "_rt_proxy_message_cascade",
      senderDiscId: "_rt_proxy_host_cascade",
    });

    await testSql`DELETE FROM users WHERE user_disc_id = ${`pk:${CASCADE_KEY}`}`;
    const [counts] = await testSql`
      SELECT
        (SELECT COUNT(*)::INT FROM external_identities WHERE external_key = ${CASCADE_KEY}) AS external_identities,
        (SELECT COUNT(*)::INT FROM message_proxy_identities cpi
          JOIN external_identities ei ON ei.external_identity_id = cpi.external_identity_id
          WHERE ei.external_key = ${CASCADE_KEY}) AS identities,
        (SELECT COUNT(*)::INT FROM message_proxy_message_index
          WHERE message_disc_id = '_rt_proxy_message_cascade') AS messages
    `;
    expect(counts).toMatchObject({ external_identities: 0, identities: 0, messages: 0 });
  });

  it("prunes only message-index rows older than the configured age", async () => {
    await testSql`
      UPDATE message_proxy_message_index
      SET created_at = NOW() - INTERVAL '40 days'
      WHERE message_disc_id = '_rt_proxy_message_1'
    `;

    expect(await messageProxyRepository.pruneMessageIndexOlderThanDays(30)).toBeGreaterThanOrEqual(1);
    const identities = await messageProxyRepository.getMessageIdentitiesByMessageIds([
      "_rt_proxy_message_1",
      "_rt_proxy_message_2",
    ]);
    expect(identities?.has("_rt_proxy_message_1")).toBe(false);
    expect(identities?.has("_rt_proxy_message_2")).toBe(true);
  });

  it("round-trips null, disabled, supported, and unknown service selections", async () => {
    for (const serviceId of [null, "none", "pluralkit", "removed_service"] as const) {
      const imported = await importRepository.importPersonalSettings("_rt_message_proxy_settings", {
        user_nickname: "Settings Fixture",
        language_pref: "en-US",
        physical_appearance_tags: [],
        persona_naming_preferences: [],
        message_proxy_service: serviceId,
      });
      expect(imported).toEqual({ success: true, itemsImported: { configFieldsCount: 3 } });
      expect((await userRepository.loadByDiscordId("_rt_message_proxy_settings"))?.message_proxy_service).toBe(
        serviceId,
      );

      const exported = await exportRepository.exportPersonalSettings("_rt_message_proxy_settings");
      expect(exported.success).toBe(true);
      if (exported.data?.type === "personal_settings") expect(exported.data.data.message_proxy_service).toBe(serviceId);
    }
  });

  it("preserves a stored selection when an older import omits the field", async () => {
    const imported = await importRepository.importPersonalSettings("_rt_message_proxy_settings", {
      user_nickname: "Settings Fixture",
      language_pref: "en-US",
      physical_appearance_tags: [],
      persona_naming_preferences: [],
    });

    expect(imported.success).toBe(true);
    expect((await userRepository.loadByDiscordId("_rt_message_proxy_settings"))?.message_proxy_service).toBe(
      "removed_service",
    );
  });
});
