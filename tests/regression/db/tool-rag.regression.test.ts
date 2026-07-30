/**
 * Regression harness: ToolRepository + RagRepository domains.
 *
 * ToolRepository: MCP server config, guild MCP reads.
 * RagRepository: RAG availability detection (schema-level, no pgvector assumed).
 *
 * Requires: a local Postgres connection (see docs/guides/testing-db-changes.md)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mcpRepository, toolRepository } from "@/utils/db/repositories";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Tool — regression", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  // ── brave API key status ──────────────────────────────────────────────────
  // getBraveApiKeyStatus is representative of the ToolRepository read path.

  it("getBraveApiKeyStatus reflects brave-search key rows", async () => {
    const hasKey = await toolRepository.getBraveApiKeyStatus(refs.serverId);
    expect(hasKey).toBe(false);

    await testSql`
      INSERT INTO opt_api_keys (server_id, service_name, api_key)
      VALUES (${refs.serverId}, 'brave-search', decode('01', 'hex'))
      ON CONFLICT (server_id, service_name)
      DO UPDATE SET api_key = EXCLUDED.api_key
    `;

    const hasInsertedKey = await toolRepository.getBraveApiKeyStatus(refs.serverId);
    expect(hasInsertedKey).toBe(true);
  });

  // ── guild MCP config ──────────────────────────────────────────────────────
  // guildMcpDb.ts reads from mcp_server_configs; no config means empty result.

  it("guild MCP config read returns inserted config rows", async () => {
    const beforeInsert = await mcpRepository.loadGuildMcpConfigs(refs.serverId);
    expect(beforeInsert).toEqual([]);

    await testSql`
      INSERT INTO guild_mcp_servers (server_id, name, url, is_enabled, server_type)
      VALUES (${refs.serverId}, '_rt_mcp_search', 'https://mcp.example.invalid/sse', false, 'web_search')
    `;

    const configs = await mcpRepository.loadGuildMcpConfigs(refs.serverId);
    const stableShape = configs.map(({ server_id, name, url, auth_token, key_version, is_enabled, server_type }) => ({
      server_id,
      name,
      url,
      auth_token,
      key_version,
      is_enabled,
      server_type,
    }));

    expect(typeof configs[0]?.guild_mcp_id).toBe("number");
    expect(stableShape).toEqual([
      {
        server_id: refs.serverId,
        name: "_rt_mcp_search",
        url: "https://mcp.example.invalid/sse",
        auth_token: null,
        key_version: 1,
        is_enabled: false,
        server_type: "web_search",
      },
    ]);
  });
});

describe.skipIf(!DB_TESTS_AVAILABLE)("RAG — regression", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  // ── RAG availability ──────────────────────────────────────────────────────
  // detectRagAvailability probes for the pgvector extension; the expected value
  // depends on the local Postgres image, so compare it to the same catalog query.

  it("detectRagAvailability matches pg_available_extensions for vector", async () => {
    const { detectRagAvailability } = await import("@/utils/db/ragAvailability");
    const [row] = await testSql<Array<{ available: boolean }>>`
      SELECT EXISTS(
        SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
      ) AS available
    `;
    const available = await detectRagAvailability(testSql);
    expect(available).toBe(Boolean(row?.available));
  });
});
