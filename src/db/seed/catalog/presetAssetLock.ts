import type { SQL } from "bun";

// The bot can upload an older content-addressed key before its catalog row is written. A sweep
// must not delete that key during the gap, so both operations hold this transaction-scoped lock.
// The catalog is small enough to keep one transaction open across its storage uploads. If uploads
// approach the database's idle-transaction timeout, use a dedicated reserved session connection.
const PRESET_ASSET_LOCK_NAMESPACE = 1872156021;
const PRESET_ASSET_LOCK_KEY = 1;

export async function withPresetAssetLock<T>(client: SQL, action: (lockedClient: SQL) => Promise<T>): Promise<T> {
  return await client.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${PRESET_ASSET_LOCK_NAMESPACE}, ${PRESET_ASSET_LOCK_KEY})`;
    return await action(tx);
  });
}
