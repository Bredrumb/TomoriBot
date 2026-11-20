import type { SQL } from "bun";

// Advisory xact lock prevents asset sweeps from deleting newly uploaded catalog keys before their rows commit (switch
// to a session lock if uploads ever approach the idle-transaction timeout).
const PRESET_ASSET_LOCK_NAMESPACE = 1872156021;
const PRESET_ASSET_LOCK_KEY = 1;

export async function withPresetAssetLock<T>(client: SQL, action: (lockedClient: SQL) => Promise<T>): Promise<T> {
  return await client.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${PRESET_ASSET_LOCK_NAMESPACE}, ${PRESET_ASSET_LOCK_KEY})`;
    return await action(tx);
  });
}
