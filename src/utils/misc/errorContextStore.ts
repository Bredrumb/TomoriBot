import { AsyncLocalStorage } from "node:async_hooks";
import type { ErrorContext } from "@/types/db/schema";

// Discord snowflakes ride in ErrorContext.metadata because typed ID fields hold DB row IDs, so these fixed key names
// keep log queries consistent.
export interface AmbientErrorIdentity {
  personaId?: number | null;
  userId?: number | null;
  serverId?: number | null;
  userDiscId?: string | null;
  serverDiscId?: string | null;
  channelDiscId?: string | null;
  source?: string;
  sourceDetail?: string;
}

// Kept mutable so a scope opened before DB IDs resolve can be enriched in place while callers hold the same object.
type AmbientErrorScope = { identity: AmbientErrorIdentity };

const storage = new AsyncLocalStorage<AmbientErrorScope>();

export function runWithErrorContext<T>(identity: AmbientErrorIdentity, fn: () => Promise<T>): Promise<T> {
  const parent = storage.getStore();
  return storage.run({ identity: { ...parent?.identity, ...stripAbsent(identity) } }, fn);
}

export function enrichErrorContext(identity: AmbientErrorIdentity): void {
  const scope = storage.getStore();
  if (!scope) {
    return;
  }
  Object.assign(scope.identity, stripAbsent(identity));
}

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

// Null is stripped alongside undefined because Discord fields such as interaction.guildId are null in DMs and would
// otherwise clobber parent scope IDs.
function stripAbsent(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}
