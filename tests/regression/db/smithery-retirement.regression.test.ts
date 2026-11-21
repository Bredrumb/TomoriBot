import { afterAll, beforeAll, expect, it } from "bun:test";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const PASSPHRASE = "smithery-retirement-fixture";

let refs: FixtureRefs;
beforeAll(async () => {
  if (!DB_TESTS_AVAILABLE) return;
  await setupTestDb();
  refs = await insertFixtures(testSql);
});
afterAll(async () => {
  if (DB_TESTS_AVAILABLE) await cleanupFixtures(testSql);
});

it.skipIf(!DB_TESTS_AVAILABLE)(
  "disables Smithery registrations and clears their keys, leaving other hosts alone",
  async () => {
    await testSql`
    INSERT INTO guild_mcp_servers (server_id, name, url, auth_token, is_enabled, failing_since, failure_reason)
    VALUES
      (${refs.serverId}, 'relay', 'https://fixture.run.tools/mcp', pgp_sym_encrypt('relay-key', ${PASSPHRASE}), true, NOW(), 'unauthorized'),
      (${refs.serverId}, 'direct', 'https://mcp.example.org/fixture.run.tools/mcp', pgp_sym_encrypt('direct-key', ${PASSPHRASE}), true, NULL, NULL)
  `;

    await executeTestSqlFile("src/db/migrations/128_retire_smithery_registrations.sql");

    const rows = await testSql<
      {
        name: string;
        is_enabled: boolean;
        token: string | null;
        failing_since: Date | null;
        failure_reason: string | null;
      }[]
    >`
    SELECT name, is_enabled, pgp_sym_decrypt(auth_token, ${PASSPHRASE}) AS token, failing_since, failure_reason
    FROM guild_mcp_servers WHERE server_id = ${refs.serverId} AND name IN ('relay', 'direct')
  `;
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get("relay")).toEqual({
      name: "relay",
      is_enabled: false,
      token: null,
      failing_since: null,
      failure_reason: null,
    });
    expect(byName.get("direct")).toMatchObject({ is_enabled: true, token: "direct-key" });
  },
);
