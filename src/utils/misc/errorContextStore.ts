import { AsyncLocalStorage } from "node:async_hooks";
import type { ErrorContext } from "@/types/db/schema";

/**
 * Discord snowflakes travel in `ErrorContext.metadata` because the typed ID fields are
 * database row IDs. Naming them here keeps every producer emitting the same keys, so a
 * log query can filter on `context.metadata.serverDiscId` across unrelated subsystems.
 */
export interface AmbientErrorIdentity {
  personaId?: number | null;
  userId?: number | null;
  serverId?: number | null;
  userDiscId?: string | null;
  serverDiscId?: string | null;
  channelDiscId?: string | null;
  /** Which entry point opened the scope (`chat`, `reminder`, `random_trigger`, `command`). */
  source?: string;
  /** Slash command name, reminder ID, trigger ID: whatever identifies this unit of work. */
  sourceDetail?: string;
}

/**
 * Mutable so a scope opened before the database IDs are known can be enriched in place
 * once admission resolves them. Callers hold the same object for the scope's lifetime.
 */
type AmbientErrorScope = { identity: AmbientErrorIdentity };

const storage = new AsyncLocalStorage<AmbientErrorScope>();

/**
 * Runs `fn` inside an ambient error-identity scope. Every `log.error` reached from `fn`,
 * at any await depth, is attributed to this identity without threading a parameter through
 * the call chain. Timers and event handlers started outside the scope are unaffected.
 */
export function runWithErrorContext<T>(identity: AmbientErrorIdentity, fn: () => Promise<T>): Promise<T> {
  const parent = storage.getStore();
  return storage.run({ identity: { ...parent?.identity, ...stripAbsent(identity) } }, fn);
}

/**
 * Adds fields to the active scope, for IDs that only become known partway through the work
 * (a chat turn learns its `server_id` after admission, not at entry). No-op outside a scope.
 */
export function enrichErrorContext(identity: AmbientErrorIdentity): void {
  const scope = storage.getStore();
  if (!scope) {
    return;
  }
  Object.assign(scope.identity, stripAbsent(identity));
}

/**
 * Merges the ambient identity beneath an explicit context. Explicit fields always win: a
 * call site that names its own IDs is more specific than the enclosing scope.
 */
export function resolveErrorContext(explicit?: ErrorContext): ErrorContext | undefined {
  const ambient = storage.getStore()?.identity;
  if (!ambient) {
    return explicit;
  }

  const { personaId, userId, serverId, ...snowflakes } = ambient;
  const merged: ErrorContext = {
    ...(personaId != null ? { personaId } : {}),
    ...(userId != null ? { userId } : {}),
    ...(serverId != null ? { serverId } : {}),
    ...explicit,
  };

  const ambientMetadata = stripAbsent(snowflakes);
  if (Object.keys(ambientMetadata).length > 0 || explicit?.metadata) {
    merged.metadata = { ...ambientMetadata, ...explicit?.metadata };
  }

  return merged;
}

/**
 * Drops null alongside undefined because callers pass through Discord fields that are
 * natively null when inapplicable (`interaction.guildId` in a DM). Treating those as a
 * value would clobber a parent scope's real ID on merge and stamp `serverDiscId: null`
 * onto every DM error record. A scope signals absence, never erasure.
 */
function stripAbsent(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}
