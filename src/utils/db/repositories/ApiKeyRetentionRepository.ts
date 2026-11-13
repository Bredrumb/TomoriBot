import { sql } from "@/utils/db/client";
import type { SQL } from "bun";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { clearNovelaiSubscriptionCache } from "@/utils/cache/novelaiSubscriptionCache";
import { ENCRYPTED_COLUMNS } from "@/utils/security/encryptedColumns";

export const API_KEY_OWNERS = ENCRYPTED_COLUMNS.filter(
  (target) =>
    target.column === "api_key" &&
    (target.table === "saved_provider_configs" ||
      target.table === "user_saved_provider_configs" ||
      target.table === "api_key_rotation" ||
      target.table === "opt_api_keys" ||
      target.table === "server_model_configs"),
);

export interface CredentialActivityReference {
  table: (typeof API_KEY_OWNERS)[number]["table"];
  id: number;
  epoch: string;
}

function activityGenerationColumn(table: CredentialActivityReference["table"]): string {
  return table === "saved_provider_configs" || table === "user_saved_provider_configs"
    ? "credential_revision"
    : "credential_activity_epoch";
}

export async function loadCredentialActivityReferences(
  ciphertext: Buffer,
  client: SQL = sql,
): Promise<CredentialActivityReference[]> {
  const lookup = API_KEY_OWNERS.map(
    (owner) => client`
    SELECT ${owner.table}::text AS credential_table, ${client(owner.id)} AS id,
      ${client(activityGenerationColumn(owner.table))}::text AS epoch
    FROM ${client(owner.table)} WHERE api_key = ${ciphertext}
  `,
  ).reduce((left, right) => client`${left} UNION ALL ${right}`);
  const rows = await client<
    { credential_table: CredentialActivityReference["table"]; id: number; epoch: string }[]
  >`${lookup}`;
  const references = rows.map(({ credential_table, ...row }) => ({ table: credential_table, ...row }));
  references.sort(
    (left, right) =>
      API_KEY_OWNERS.findIndex((owner) => owner.table === left.table) -
        API_KEY_OWNERS.findIndex((owner) => owner.table === right.table) || left.id - right.id,
  );
  return references;
}

export async function recordCredentialRequestAttempt(
  references: readonly CredentialActivityReference[],
  client: SQL = sql,
): Promise<void> {
  if (references.length === 0) throw new Error("Stored credential is no longer available");
  await client.begin(async (tx) => {
    // Request telemetry must not make configuration panels report a settings edit.
    await tx`SELECT set_config('tomori.credential_activity_update', 'true', true)`;
    for (const reference of references) {
      const owner = API_KEY_OWNERS.find((entry) => entry.table === reference.table);
      if (!owner) throw new Error("Unknown credential owner");
      const updated = await tx`
        UPDATE ${tx(owner.table)} SET credential_last_attempt_at = clock_timestamp()
        WHERE ${tx(owner.id)} = ${reference.id}
          AND ${tx(activityGenerationColumn(owner.table))}::text = ${reference.epoch} AND api_key IS NOT NULL
        RETURNING ${tx(owner.id)}
      `;
      if (updated.length !== 1) throw new Error("Stored credential changed before dispatch");
    }
  });
}

const CLEANUP_BATCH_SIZE = 20;

export interface RetiredApiKey {
  table: CredentialActivityReference["table"];
  id: number;
  serverId: number | null;
  userId: number | null;
  serverDiscId: string | null;
}

export async function clearInactiveApiKeys(days: number, client: SQL = sql): Promise<RetiredApiKey[]> {
  const retired: RetiredApiKey[] = [];
  for (const owner of API_KEY_OWNERS) {
    const cleared = await client.begin(async (tx) => {
      const personal = owner.table === "user_saved_provider_configs";
      const legacy = owner.table === "server_model_configs";
      const optional = owner.table === "opt_api_keys";
      const provider = legacy
        ? tx`(SELECT llm_provider FROM llms WHERE llm_id = credentials.llm_id)`
        : optional
          ? tx`NULL::text`
          : tx`credentials.provider`;
      const candidates = await tx<
        {
          id: number;
          epoch: string;
          server_id: number | null;
          user_id: number | null;
          server_disc_id: string | null;
          provider: string | null;
        }[]
      >`
        SELECT ${tx(owner.id)} AS id, ${tx(activityGenerationColumn(owner.table))}::text AS epoch,
          ${personal ? tx`NULL::int` : tx`server_id`} AS server_id,
          ${personal ? tx`user_id` : tx`NULL::int`} AS user_id,
          ${personal ? tx`NULL::text` : tx`(SELECT server_disc_id FROM servers WHERE server_id = credentials.server_id)`} AS server_disc_id,
          ${provider} AS provider
        FROM ${tx(owner.table)} credentials
        WHERE api_key IS NOT NULL
          AND COALESCE(credential_last_attempt_at, credential_created_at) <= clock_timestamp() - make_interval(days => ${days})
          AND ${owner.table === "api_key_rotation" ? tx`is_main_key_pointer IS NOT TRUE` : tx`TRUE`}
          AND ${optional ? tx`TRUE` : tx`${provider} IS DISTINCT FROM 'vertex'`}
          AND NOT EXISTS (
            SELECT 1 FROM custom_endpoint_connections c
            WHERE 'custom:' || c.connection_id::text = ${provider} AND NOT c.requires_auth
          )
        ORDER BY ${tx(owner.id)} LIMIT ${CLEANUP_BATCH_SIZE}
        FOR UPDATE OF credentials SKIP LOCKED
      `;
      const result: RetiredApiKey[] = [];
      for (const candidate of candidates) {
        let successor:
          | {
              rotation_key_id: number;
              api_key: Buffer;
              key_version: number | null;
              credential_created_at: Date;
              credential_last_attempt_at: Date | null;
            }
          | undefined;
        if (owner.table === "saved_provider_configs") {
          [successor] = await tx`
            SELECT rotation_key_id, api_key, key_version, credential_created_at, credential_last_attempt_at
            FROM api_key_rotation
            WHERE server_id = ${candidate.server_id} AND provider = ${candidate.provider}
              AND NOT is_main_key_pointer AND is_enabled AND api_key IS NOT NULL
              AND COALESCE(credential_last_attempt_at, credential_created_at) > clock_timestamp() - make_interval(days => ${days})
            ORDER BY rotation_key_id LIMIT 1 FOR UPDATE SKIP LOCKED
          `;
          if (!successor) {
            const [busy] = await tx`SELECT EXISTS (
              SELECT 1 FROM api_key_rotation WHERE server_id = ${candidate.server_id} AND provider = ${candidate.provider}
                AND NOT is_main_key_pointer AND is_enabled AND api_key IS NOT NULL
                AND COALESCE(credential_last_attempt_at, credential_created_at) > clock_timestamp() - make_interval(days => ${days})
            ) AS available`;
            if (busy.available) continue;
          }
        }
        const removed =
          optional || owner.table === "api_key_rotation"
            ? await tx`
              DELETE FROM ${tx(owner.table)} WHERE ${tx(owner.id)} = ${candidate.id}
                AND ${tx(activityGenerationColumn(owner.table))}::text = ${candidate.epoch}
                AND COALESCE(credential_last_attempt_at, credential_created_at) <= clock_timestamp() - make_interval(days => ${days})
              RETURNING ${tx(owner.id)}
            `
            : await tx`
              UPDATE ${tx(owner.table)} SET api_key = ${successor?.api_key ?? null},
                key_version = COALESCE(${successor ? (successor.key_version ?? 1) : null}, key_version)
              WHERE ${tx(owner.id)} = ${candidate.id} AND ${tx(activityGenerationColumn(owner.table))}::text = ${candidate.epoch}
                AND COALESCE(credential_last_attempt_at, credential_created_at) <= clock_timestamp() - make_interval(days => ${days})
              RETURNING ${tx(owner.id)}
            `;
        if (removed.length === 0) continue;
        if (owner.table === "saved_provider_configs") {
          await tx`
            UPDATE server_model_configs SET api_key = NULL
            WHERE server_id = ${candidate.server_id}
              AND llm_id IN (SELECT llm_id FROM llms WHERE llm_provider = ${candidate.provider})
          `;
          await tx`
            DELETE FROM api_key_rotation WHERE server_id = ${candidate.server_id}
              AND provider = ${candidate.provider} AND is_main_key_pointer
          `;
          if (successor) {
            await tx`UPDATE saved_provider_configs SET credential_created_at = ${successor.credential_created_at},
              credential_last_attempt_at = ${successor.credential_last_attempt_at}
              WHERE saved_config_id = ${candidate.id}`;
            await tx`UPDATE api_key_rotation SET api_key = NULL, is_main_key_pointer = true
              WHERE rotation_key_id = ${successor.rotation_key_id}`;
          }
        }
        if (legacy) {
          await tx`DELETE FROM api_key_rotation WHERE server_id = ${candidate.server_id}
            AND provider = ${candidate.provider} AND is_main_key_pointer
            AND NOT EXISTS (
              SELECT 1 FROM saved_provider_configs saved
              WHERE saved.server_id = ${candidate.server_id} AND saved.provider = ${candidate.provider}
                AND saved.api_key IS NOT NULL
            )`;
        }
        result.push({
          table: owner.table,
          id: candidate.id,
          serverId: candidate.server_id,
          userId: candidate.user_id,
          serverDiscId: candidate.server_disc_id,
        });
      }
      return result;
    });
    for (const entry of cleared) {
      if (entry.serverDiscId) invalidateTomoriStateCache(entry.serverDiscId);
    }
    if (cleared.length > 0) clearNovelaiSubscriptionCache();
    retired.push(...cleared);
  }
  return retired;
}
