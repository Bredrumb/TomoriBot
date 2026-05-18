/**
 * Fixture management for DB regression tests.
 *
 * Inserts minimal rows required by the harness and provides a single
 * cleanupFixtures() call that removes them all via FK cascades.
 *
 * Naming: all test rows use the "_rt_" prefix so they can never collide
 * with real data and so cleanup can target them precisely.
 */
import type { SQL } from "bun";

/** Stable Discord-scoped identifiers for all fixture rows. */
export const FIXTURE_IDS = {
  serverDiscId: "_rt_server_001",
  userDiscId: "_rt_user_001",
  regUserDiscId: "_rt_user_reg_001", // used by write tests that registerUser
  altUserDiscId: "_rt_user_alt_001", // for personal memory tests
} as const;

/** Internal DB IDs populated after insertFixtures() runs. */
export interface FixtureRefs {
  serverId: number;
  personaId: number;
  personaLineageId: number;
  userId: number;
}

const SERVER_CONFIG_TABLES = [
  "server_model_configs",
  "server_chat_configs",
  "server_member_permissions_configs",
  "server_capabilities_configs",
  "server_notice_embeds_configs",
  "server_nsfw_configs",
  "server_speech_configs",
  "server_auto_trigger_configs",
  "server_channel_scope_configs",
  "server_trigger_behavior_configs",
  "server_byok_configs",
  "server_novelai_imagegen_configs",
  "server_memory_configs",
  "server_welcome_configs",
] as const;

/**
 * Inserts the minimal fixture set needed across all regression test files.
 * Idempotent — uses ON CONFLICT DO NOTHING wherever possible.
 *
 * @param db - The test SQL client from testDb.ts
 * @returns Internal DB IDs for test assertions that need them
 */
export async function insertFixtures(db: SQL): Promise<FixtureRefs> {
  // 1. Server
  const [serverRow] = await db`
    INSERT INTO servers (server_disc_id)
    VALUES (${FIXTURE_IDS.serverDiscId})
    ON CONFLICT (server_disc_id) DO UPDATE SET server_disc_id = EXCLUDED.server_disc_id
    RETURNING server_id
  `;
  const serverId: number = serverRow.server_id;

  // 2. Persona (llm_id left NULL → BYOK/unconfigured mode; avoids needing a real LLM row)
  const [personaRow] = await db`
    INSERT INTO personas (server_id, persona_nickname, is_alter)
    VALUES (${serverId}, '_rt_persona', false)
    ON CONFLICT DO NOTHING
    RETURNING persona_id, persona_lineage_id
  `;

  let personaId: number;
  let personaLineageId: number;

  if (personaRow) {
    personaId = personaRow.persona_id;
    personaLineageId = Number(personaRow.persona_lineage_id);
  } else {
    // Row already existed — re-query to get the IDs
    const [existing] = await db`
      SELECT persona_id, persona_lineage_id
      FROM personas
      WHERE server_id = ${serverId} AND is_alter = false
      LIMIT 1
    `;
    personaId = existing.persona_id;
    personaLineageId = Number(existing.persona_lineage_id);
  }

  // Reset mutable fixture fields so failed/interrupted prior runs cannot leak
  // renamed personas or changed config into the next harness run.
  await db`
    UPDATE personas
    SET persona_nickname = '_rt_persona'
    WHERE persona_id = ${personaId}
  `;

  // 3. Server-scoped split config rows.
  for (const table of SERVER_CONFIG_TABLES) {
    await db.unsafe(`INSERT INTO ${table} (server_id) VALUES ($1) ON CONFLICT (server_id) DO NOTHING`, [serverId]);
  }

  // 4. Persona-scoped config
  await db`
    INSERT INTO persona_configs (persona_id, trigger_words)
    VALUES (${personaId}, ARRAY['_rt_trigger']::TEXT[])
    ON CONFLICT (persona_id) DO UPDATE SET trigger_words = EXCLUDED.trigger_words
  `;

  // 5. Test user
  const [userRow] = await db`
    INSERT INTO users (user_disc_id, user_nickname)
    VALUES (${FIXTURE_IDS.userDiscId}, '_rt_user')
    ON CONFLICT (user_disc_id) DO UPDATE
    SET
      user_nickname = EXCLUDED.user_nickname,
      privacy_level = 0,
      shortterm_cache_crossserver_opt_in = false,
      personal_dtm = 'follow'
    RETURNING user_id
  `;
  const userId: number = userRow.user_id;

  return { serverId, personaId, personaLineageId, userId };
}

/**
 * Removes all fixture rows created by insertFixtures().
 * Cascade deletes handle child rows (personas, split config tables, persona_configs,
 * server_memories) when the servers row is deleted.
 *
 * @param db - The test SQL client from testDb.ts
 */
export async function cleanupFixtures(db: SQL): Promise<void> {
  // Cascade via FK: deletes personas, split config rows, persona_configs, server_memories
  await db`DELETE FROM servers WHERE server_disc_id = ${FIXTURE_IDS.serverDiscId}`;

  // Users have no cascade from servers — clean up separately
  await db`DELETE FROM users WHERE user_disc_id LIKE '_rt_%'`;
}
