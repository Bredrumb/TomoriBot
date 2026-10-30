import { afterAll, beforeAll, expect, it } from "bun:test";
import { OAuthStateRepository } from "@/utils/db/repositories/OAuthStateRepository";
import { createAndPersistOAuthState, validateAndConsumeOAuthState } from "@/utils/oauth/state";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const FLOW = "mcp";
const SIGNER = "oauth-states-fixture";

beforeAll(async () => {
  if (DB_TESTS_AVAILABLE) await setupTestDb();
});
afterAll(async () => {
  if (DB_TESTS_AVAILABLE) await testSql`DELETE FROM oauth_states WHERE flow = ${FLOW}`;
});

it.skipIf(!DB_TESTS_AVAILABLE)("consumes a state nonce once and purges finished states", async () => {
  const repository = new OAuthStateRepository(testSql);
  const now = new Date();
  const live = await createAndPersistOAuthState({
    flow: FLOW,
    subject: "_rt_server_001",
    signerSecret: SIGNER,
    ttlSeconds: 600,
    stateRepository: repository,
    now,
  });
  const pending = await createAndPersistOAuthState({
    flow: FLOW,
    subject: "_rt_server_001",
    signerSecret: SIGNER,
    ttlSeconds: 600,
    stateRepository: repository,
    now,
  });

  expect((await validateAndConsumeOAuthState(live.state, SIGNER, repository, now, FLOW)).valid).toBe(true);
  expect(await validateAndConsumeOAuthState(live.state, SIGNER, repository, now, FLOW)).toEqual({
    valid: false,
    reason: "replay",
  });

  await repository.purgeFinishedStates(new Date(now.getTime() + 1000));
  const remaining = await testSql<{ nonce_hash: string }[]>`SELECT nonce_hash FROM oauth_states WHERE flow = ${FLOW}`;
  expect(remaining.map((row) => row.nonce_hash)).toEqual([pending.nonceHash]);
});
