/**
 * Regression harness — ToolRepository + RagRepository domains.
 *
 * ToolRepository: MCP server config, guild MCP reads.
 * RagRepository: RAG availability detection (schema-level, no pgvector assumed).
 *
 * Requires: POSTGRES_DB=tomodb_test (see docs/guides/testing-db-changes.md)
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

  it("getBraveApiKeyStatus returns false when no key is configured", async () => {
    const hasKey = await toolRepository.getBraveApiKeyStatus(refs.serverId);
    // Fixture server has no Brave key — must return false, not throw
    expect(hasKey).toBe(false);
  });

  // ── guild MCP config ──────────────────────────────────────────────────────
  // guildMcpDb.ts reads from mcp_server_configs; no config means empty result.

  it("guild MCP config read returns empty array for unconfigured server", async () => {
    const configs = await mcpRepository.loadGuildMcpConfigs(refs.serverId);
    expect(Array.isArray(configs)).toBe(true);
    // Fresh fixture server has no MCP config rows
    expect(configs).toHaveLength(0);
  });
});

describe.skipIf(!DB_TESTS_AVAILABLE)("RAG — regression", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  // ── RAG availability ──────────────────────────────────────────────────────
  // detectRagAvailability probes for the pgvector extension.
  // In the test DB, pgvector may or may not be installed — both outcomes are valid.

  it("detectRagAvailability returns a boolean without throwing", async () => {
    const { detectRagAvailability } = await import("@/utils/db/ragAvailability");
    const available = await detectRagAvailability();
    expect(typeof available).toBe("boolean");
  });
});
