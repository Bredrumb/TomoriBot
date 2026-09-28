/**
 * PluralKit v2 API client.
 * Resolves the identity behind a proxied webhook message (member/system/host)
 * via `GET /v2/messages/{messageId}`.
 */

import { z } from "zod";
import { log } from "@/utils/misc/logger";

const PK_API_BASE_URL = "https://api.pluralkit.me/v2";

/** Overall retry budget for a single message lookup, in milliseconds. */
function getLookupTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.PLURALKIT_LOOKUP_TIMEOUT_MS || "5000", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}

/**
 * Optional bot-owned PK token, sent as-is in the Authorization header (no "Bearer"
 * prefix: this is PluralKit's own convention, not OAuth). Raises the base rate
 * limit for all lookups; grants no access to other users' private data.
 */
/** Backoff schedule between retries, in ms; PK's message index lags ~2s behind proxied sends */
const RETRY_DELAYS_MS = [800, 1600, 3200];

/** Cap on permanently-cached resolved identities (a message's identity never changes once known) */
const IDENTITY_CACHE_MAX_ENTRIES = 2000;

const pkSystemInfoSchema = z.object({
  id: z.string().min(1),
  uuid: z.string().uuid(),
  name: z.string().nullable().optional(),
  tag: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

const pkMemberInfoSchema = z.object({
  id: z.string().min(1),
  uuid: z.string().uuid(),
  name: z.string().min(1),
  display_name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export type PkSystemInfo = z.infer<typeof pkSystemInfoSchema>;
export type PkMemberInfo = z.infer<typeof pkMemberInfoSchema>;

/** Resolved PluralKit identity behind a proxied webhook message */
export interface PkMessageLookup {
  /** The original (pre-proxy, now-deleted) message's Discord snowflake ID */
  original: string;
  /** The host Discord account snowflake that sent/proxied the message; authorization keys off this, never the member */
  sender: string;
  /** The fronting member's system, or null if the member (and thus its system) was deleted */
  system: PkSystemInfo | null;
  /** The fronting member, or null if deleted; treat as an unproxied webhook with no identity claims */
  member: PkMemberInfo | null;
}

/** Raw PK API response shape for `GET /messages/{id}` (subset of fields we use) */
const pkApiMessageResponseSchema = z.object({
  original: z.string().min(1).optional(),
  sender: z.string().min(1),
  system: pkSystemInfoSchema.nullable().optional(),
  member: pkMemberInfoSchema.nullable().optional(),
});

type PkApiMessageResponse = z.infer<typeof pkApiMessageResponseSchema>;

// Single-flight + permanent cache: a message's PK identity is immutable once
// resolved, so successful lookups never need to be refetched. Transient
// failures (network errors, exhausted retries) are deliberately NOT cached,
// because caching them would permanently poison a message that PK could resolve fine
// on a later attempt (e.g. after an outage clears).
const identityCache = new Map<string, PkMessageLookup>();
const inFlightLookups = new Map<string, Promise<PkMessageLookup | null>>();

/**
 * Inserts a resolved identity into the permanent cache, evicting the oldest
 * entry first if at capacity. Entries are never re-set once cached, so
 * insertion order doubles as recency for this simple LRU-style cap.
 */
function rememberIdentity(messageId: string, lookup: PkMessageLookup): void {
  if (identityCache.size >= IDENTITY_CACHE_MAX_ENTRIES) {
    const oldestKey = identityCache.keys().next().value;
    if (oldestKey !== undefined) identityCache.delete(oldestKey);
  }
  identityCache.set(messageId, lookup);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses a `Retry-After` header (seconds) into milliseconds; null if missing
 * or insane. Zero counts as insane: PK's rate limiter is known to accidentally
 * send `Retry-After: 0`, and honoring it would mean retrying a
 * rate-limited endpoint immediately, so fall back to the backoff schedule instead.
 */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number.parseFloat(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

function toMessageLookup(raw: PkApiMessageResponse, messageId: string): PkMessageLookup {
  return {
    original: raw.original ?? messageId,
    sender: raw.sender,
    system: raw.system ?? null,
    member: raw.member ?? null,
  };
}

/**
 * Attempts the PK message lookup with retries, bounded by `deadline`.
 * Returns null once the budget is exhausted or PK returns a non-retryable
 * error, because callers must fall through to today's plain-webhook behavior
 * in that case, never inventing an identity.
 */
async function fetchWithRetry(
  messageId: string,
  deadline: number,
  lookupTimeoutMs: number,
): Promise<PkMessageLookup | null> {
  let attempt = 0;

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      log.warn(
        `PluralKit lookup for message ${messageId} exceeded the ${lookupTimeoutMs}ms budget; treating as unproxied`,
      );
      return null;
    }

    try {
      const headers: Record<string, string> = {};
      const apiToken = process.env.PLURALKIT_API_TOKEN?.trim();
      if (apiToken) headers.Authorization = apiToken;

      const response = await fetch(`${PK_API_BASE_URL}/messages/${messageId}`, {
        headers,
        signal: AbortSignal.timeout(remainingMs),
      });

      if (response.ok) {
        let raw: unknown;
        try {
          raw = await response.json();
        } catch (error) {
          log.warn(`PluralKit lookup for message ${messageId} returned malformed JSON`, error);
          return null;
        }
        const parsed = pkApiMessageResponseSchema.safeParse(raw);
        if (!parsed.success) {
          log.warn(`PluralKit lookup for message ${messageId} returned an invalid payload`);
          return null;
        }
        return toMessageLookup(parsed.data, messageId);
      }

      // 404: PK's message index lags ~2s behind proxied sends, so retry within budget.
      // 429: honor Retry-After when sane, otherwise fall back to the backoff schedule.
      if (response.status === 404 || response.status === 429) {
        const backoff = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response.headers.get("Retry-After")) : null;
        const delay = Math.min(retryAfterMs ?? backoff, Math.max(deadline - Date.now(), 0));
        await sleep(delay);
        attempt++;
        continue;
      }

      log.warn(`PluralKit lookup for message ${messageId} failed with status ${response.status}`);
      return null;
    } catch (error) {
      if (deadline - Date.now() <= 0) {
        log.warn(`PluralKit lookup for message ${messageId} timed out`, error);
        return null;
      }
      const backoff = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      await sleep(Math.min(backoff, Math.max(deadline - Date.now(), 0)));
      attempt++;
    }
  }
}

/**
 * Resolves the PluralKit identity behind a webhook message (the proxy
 * repost), via `GET /v2/messages/{messageId}`.
 *
 * Retries 404s (PK indexing lag) and 429s (honoring `Retry-After`) on an
 * exponential backoff schedule, bounded by `PLURALKIT_LOOKUP_TIMEOUT_MS`
 * (default 5000ms). Returns null once that budget is exhausted or PK
 * returns a non-retryable error, because callers must fall through to today's
 * plain-webhook behavior in that case.
 *
 * Successful lookups are cached permanently in-process (a message's
 * identity never changes) under an LRU-style eviction cap; concurrent
 * calls for the same message share one in-flight request.
 */
export async function fetchMessage(messageId: string): Promise<PkMessageLookup | null> {
  const cached = identityCache.get(messageId);
  if (cached) return cached;

  const existing = inFlightLookups.get(messageId);
  if (existing) return existing;

  const lookupTimeoutMs = getLookupTimeoutMs();
  const deadline = Date.now() + lookupTimeoutMs;
  const lookupPromise = fetchWithRetry(messageId, deadline, lookupTimeoutMs)
    .then((lookup) => {
      if (lookup) rememberIdentity(messageId, lookup);
      return lookup;
    })
    .finally(() => {
      inFlightLookups.delete(messageId);
    });

  inFlightLookups.set(messageId, lookupPromise);
  return lookupPromise;
}

/**
 * Returns a successful in-process PluralKit message lookup without making any
 * network request. Context rebuilding uses this before falling back to the
 * durable DB index; it must never call the PluralKit API.
 */
export function getCachedMessageLookup(messageId: string): PkMessageLookup | null {
  return identityCache.get(messageId) ?? null;
}

/** Clears process-local transport state between isolated contract tests. */
export function clearPluralKitApiStateForTests(): void {
  identityCache.clear();
  inFlightLookups.clear();
}
