/**
 * Regression coverage for migration 083's backfill.
 *
 * `custom_endpoints.model_ref_id` is chosen by the connection's capability, so it holds an `llm_id`
 * only for text connections and an id from a different table for every other capability. The
 * backfill reads it as an `llm_id`, so without a capability filter a non-text endpoint's id can
 * match an unrelated `llms` row, including another server's model. These ids are small serial
 * integers, so the collision is ordinary rather than exotic.
 */

import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const FLAGGED_SERVER = "_verbatim_backfill_flagged_server";
const OTHER_SERVER = "_verbatim_backfill_other_server";

const migrationPath = path.join(
  process.cwd(),
  "src",
  "db",
  "migrations",
  "083_custom_endpoint_verbatim_tool_calling.sql",
);

describe.skipIf(!DB_TESTS_AVAILABLE)("Migration 083 verbatim tool-calling backfill", () => {
  let flaggedServerId: number;

  // The image connection points at a row in `image_diffusion_models`; its id is the value that must
  // never be read as an `llm_id`.
  let imageModelRefId: number;
  // A text model owned by a different server. It must stay untouched.
  let otherServerLlmId: number;

  beforeAll(async () => {
    await setupTestDb();
    await testSql`DELETE FROM servers WHERE server_disc_id IN (${FLAGGED_SERVER}, ${OTHER_SERVER})`;

    const [flagged] = await testSql`
      INSERT INTO servers (server_disc_id) VALUES (${FLAGGED_SERVER}) RETURNING server_id`;
    flaggedServerId = flagged.server_id;

    // A second server owns the model the collision points at, so the assertion is about a row the
    // flagged server has no claim to.
    await testSql`
      INSERT INTO servers (server_disc_id) VALUES (${OTHER_SERVER}) RETURNING server_id`;

    // Pre-migration state: the flag is server-wide and still present.
    await testSql`
      ALTER TABLE server_capabilities_configs
        ADD COLUMN IF NOT EXISTS verbatim_tool_calling_enabled BOOLEAN NOT NULL DEFAULT false`;
    await testSql`
      INSERT INTO server_capabilities_configs (server_id, verbatim_tool_calling_enabled)
      VALUES (${flaggedServerId}, true)
      ON CONFLICT (server_id) DO UPDATE SET verbatim_tool_calling_enabled = true`;

    const [textLlm] = await testSql`
      INSERT INTO llms (llm_provider, llm_codename) VALUES ('google', '_verbatim_backfill_own_text')
      RETURNING llm_id`;
    otherServerLlmId = (
      await testSql`
        INSERT INTO llms (llm_provider, llm_codename) VALUES ('google', '_verbatim_backfill_other_text')
        RETURNING llm_id`
    )[0].llm_id;

    // The flagged server's own text endpoint, which the backfill is supposed to switch on.
    const [textConnection] = await testSql`
      INSERT INTO custom_endpoint_connections (server_id, user_id, label, capability, api_style, endpoint_url)
      VALUES (${flaggedServerId}, NULL, '_verbatim_backfill_text', 'text', 'openai-compatible', 'http://localhost:1/v1')
      RETURNING connection_id`;
    await testSql`
      INSERT INTO custom_endpoints (connection_id, model_name, model_ref_id)
      VALUES (${textConnection.connection_id}, '_verbatim_backfill_text_model', ${textLlm.llm_id})`;

    // The collision: an image connection's model_ref_id happens to equal the other server's llm_id.
    const [imageConnection] = await testSql`
      INSERT INTO custom_endpoint_connections (server_id, user_id, label, capability, api_style, endpoint_url)
      VALUES (${flaggedServerId}, NULL, '_verbatim_backfill_image', 'image', 'comfyui', 'http://localhost:2')
      RETURNING connection_id`;
    const [imageModel] = await testSql`
      INSERT INTO image_diffusion_models (provider, codename)
      VALUES ('custom:0', '_verbatim_backfill_image_model') RETURNING diffusion_model_id`;
    imageModelRefId = imageModel.diffusion_model_id;

    // Force the collision onto the exact value the test asserts against.
    await testSql`
      UPDATE image_diffusion_models SET diffusion_model_id = ${otherServerLlmId}
      WHERE diffusion_model_id = ${imageModelRefId}`;
    imageModelRefId = otherServerLlmId;
    await testSql`
      INSERT INTO custom_endpoints (connection_id, model_name, model_ref_id)
      VALUES (${imageConnection.connection_id}, '_verbatim_backfill_image_model', ${imageModelRefId})`;

    // Replay the migration from its pre-state.
    await testSql`ALTER TABLE custom_endpoints DROP COLUMN IF EXISTS verbatim_tool_calling`;
    await testSql`ALTER TABLE llms DROP COLUMN IF EXISTS verbatim_tool_calling`;
    await executeTestSqlFile(migrationPath);
  });

  afterAll(async () => {
    await testSql`DELETE FROM servers WHERE server_disc_id IN (${FLAGGED_SERVER}, ${OTHER_SERVER})`;
    await testSql`DELETE FROM llms WHERE llm_codename LIKE '_verbatim_backfill_%'`;
    await testSql`DELETE FROM image_diffusion_models WHERE codename = '_verbatim_backfill_image_model'`;
  });

  it("does not read a non-text endpoint's model_ref_id as an llm_id", async () => {
    const [row] = await testSql<[{ verbatim_tool_calling: boolean }]>`
      SELECT verbatim_tool_calling FROM llms WHERE llm_id = ${otherServerLlmId}`;

    expect(row.verbatim_tool_calling).toBe(false);
  });

  it("still switches the flag on for the server's own text endpoint and model", async () => {
    const [endpoint] = await testSql<[{ verbatim_tool_calling: boolean }]>`
      SELECT ce.verbatim_tool_calling
      FROM custom_endpoints ce
      JOIN custom_endpoint_connections cec ON cec.connection_id = ce.connection_id
      WHERE cec.server_id = ${flaggedServerId} AND cec.label = '_verbatim_backfill_text'`;
    expect(endpoint.verbatim_tool_calling).toBe(true);

    const [model] = await testSql<[{ verbatim_tool_calling: boolean }]>`
      SELECT l.verbatim_tool_calling
      FROM llms l
      JOIN custom_endpoints ce ON ce.model_ref_id = l.llm_id
      JOIN custom_endpoint_connections cec ON cec.connection_id = ce.connection_id
      WHERE cec.server_id = ${flaggedServerId} AND cec.label = '_verbatim_backfill_text'`;
    expect(model.verbatim_tool_calling).toBe(true);
  });

  it("leaves the non-text endpoint's own flag off", async () => {
    const [endpoint] = await testSql<[{ verbatim_tool_calling: boolean }]>`
      SELECT ce.verbatim_tool_calling
      FROM custom_endpoints ce
      JOIN custom_endpoint_connections cec ON cec.connection_id = ce.connection_id
      WHERE cec.server_id = ${flaggedServerId} AND cec.label = '_verbatim_backfill_image'`;

    expect(endpoint.verbatim_tool_calling).toBe(false);
  });

  it("retires the server-wide column", async () => {
    const [row] = await testSql<[{ column_exists: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'server_capabilities_configs'
          AND column_name = 'verbatim_tool_calling_enabled'
      ) AS column_exists`;

    expect(row.column_exists).toBe(false);
  });
});
