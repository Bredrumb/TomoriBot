import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { getCachedGuildMcpConfigs } from "@/utils/cache/guildMcpConfigCache";
import { guildMcpOAuthRepository, type GuildMcpOAuthGrant } from "@/utils/db/repositories/GuildMcpOAuthRepository";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { keyManager } from "@/utils/security/keyManager";
import { cleanupFixtures, FIXTURE_IDS, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const GRANT: GuildMcpOAuthGrant = {
  issuer: "https://auth.example.invalid",
  tokenEndpoint: "https://auth.example.invalid/token",
  resource: "https://mcp.example.invalid/mcp",
  clientId: "https://bot.example.invalid/oauth/client.json",
  requestedScopes: "read write",
  grantedScopes: "read",
  accessToken: "synthetic-access-token",
  refreshToken: null,
  expiresAt: null,
};

describe.skipIf(!DB_TESTS_AVAILABLE)("Guild MCP OAuth storage", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });

  afterAll(async () => {
    await testSql`DELETE FROM mcp_oauth_clients WHERE issuer LIKE 'https://%.example.invalid'`;
    await cleanupFixtures(testSql);
  });

  async function readGrant(guildMcpId: number) {
    const key = keyManager.getCurrentKey();
    const [row] = await testSql<
      {
        access_token: string;
        access_token_key_version: number;
        refresh_token: string | null;
        refresh_token_key_version: number | null;
        expires_at: Date | null;
        requested_scopes: string | null;
        granted_scopes: string | null;
        needs_reauthorization: boolean;
      }[]
    >`
      SELECT pgp_sym_decrypt(access_token, ${key}) AS access_token, access_token_key_version,
        pgp_sym_decrypt(refresh_token, ${key}) AS refresh_token, refresh_token_key_version,
        expires_at, requested_scopes, granted_scopes, needs_reauthorization
      FROM guild_mcp_oauth WHERE guild_mcp_id = ${guildMcpId}
    `;
    return row ?? null;
  }

  it("stores the registration and its encrypted grant together, and removing the registration removes the grant", async () => {
    await getCachedGuildMcpConfigs(refs.serverId);
    const renewable = {
      ...GRANT,
      refreshToken: "synthetic-refresh-token",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    };
    const row = await toolRepository.insertMcpServer(
      refs.serverId,
      "oauth-issues",
      GRANT.resource,
      undefined,
      null,
      ["search_issues"],
      FIXTURE_IDS.serverDiscId,
      renewable,
    );
    const guildMcpId = row?.guild_mcp_id ?? 0;
    expect(row?.auth_token).toBeNull();
    expect((await getCachedGuildMcpConfigs(refs.serverId)).map((config) => config.name)).toContain("oauth-issues");
    expect(await readGrant(guildMcpId)).toEqual({
      access_token: "synthetic-access-token",
      access_token_key_version: keyManager.getCurrentVersion(),
      refresh_token: "synthetic-refresh-token",
      refresh_token_key_version: keyManager.getCurrentVersion(),
      expires_at: new Date("2030-01-01T00:00:00Z"),
      requested_scopes: "read write",
      granted_scopes: "read",
      needs_reauthorization: false,
    });

    const withoutRefresh = await toolRepository.insertMcpServer(
      refs.serverId,
      "oauth-docs",
      GRANT.resource,
      undefined,
      null,
      [],
      FIXTURE_IDS.serverDiscId,
      GRANT,
    );
    expect(await readGrant(withoutRefresh?.guild_mcp_id ?? 0)).toMatchObject({
      refresh_token: null,
      refresh_token_key_version: null,
      expires_at: null,
    });

    expect(await toolRepository.deleteMcpServerById(refs.serverId, guildMcpId, FIXTURE_IDS.serverDiscId)).toBe(true);
    expect(await readGrant(guildMcpId)).toBeNull();
  });

  it("rolls back the registration when its grant cannot be stored", async () => {
    await testSql.unsafe(`
      CREATE OR REPLACE FUNCTION reject_guild_mcp_oauth_fixture() RETURNS TRIGGER AS $$
      BEGIN RAISE EXCEPTION 'fixture grant write failure'; END;
      $$ LANGUAGE plpgsql
    `);
    await testSql.unsafe(`
      CREATE TRIGGER reject_guild_mcp_oauth_fixture BEFORE INSERT ON guild_mcp_oauth
      FOR EACH ROW EXECUTE FUNCTION reject_guild_mcp_oauth_fixture()
    `);
    try {
      expect(
        await toolRepository.insertMcpServer(
          refs.serverId,
          "oauth-rollback",
          GRANT.resource,
          undefined,
          null,
          [],
          FIXTURE_IDS.serverDiscId,
          GRANT,
        ),
      ).toBeNull();
      const [orphan] = await testSql`
        SELECT 1 FROM guild_mcp_servers WHERE server_id = ${refs.serverId} AND name = 'oauth-rollback'
      `;
      expect(orphan).toBeUndefined();
    } finally {
      await testSql.unsafe("DROP TRIGGER IF EXISTS reject_guild_mcp_oauth_fixture ON guild_mcp_oauth");
      await testSql.unsafe("DROP FUNCTION IF EXISTS reject_guild_mcp_oauth_fixture()");
    }
  });

  it("keeps one registered client per issuer and redirect URI", async () => {
    const issuer = "https://dcr.example.invalid";
    const loopback = "http://127.0.0.1:8080/oauth/callback";
    expect(await guildMcpOAuthRepository.findRegisteredClient(issuer, loopback)).toBeNull();
    expect(await guildMcpOAuthRepository.saveRegisteredClient(issuer, loopback, "first-client")).toBe("first-client");
    expect(await guildMcpOAuthRepository.saveRegisteredClient(issuer, loopback, "racing-client")).toBe("first-client");
    expect(await guildMcpOAuthRepository.findRegisteredClient(issuer, loopback)).toBe("first-client");
    const movedPort = "http://127.0.0.1:9090/oauth/callback";
    expect(await guildMcpOAuthRepository.findRegisteredClient(issuer, movedPort)).toBeNull();
  });

  it("applies migration 130 over the baseline schema without changing it", async () => {
    await executeTestSqlFile("src/db/migrations/130_guild_mcp_oauth.sql");
    const [table] = await testSql`SELECT to_regclass('public.guild_mcp_oauth') IS NOT NULL AS present`;
    expect(table?.present).toBe(true);
  });
});
