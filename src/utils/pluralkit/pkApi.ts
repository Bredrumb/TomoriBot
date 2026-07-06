/**
 * PluralKit v2 API client.
 * Resolves the identity behind a proxied webhook message (member/system/host)
 * via `GET /v2/messages/{messageId}`. See plans/pluralkit-integration.md §5.
 */

import { log } from "@/utils/misc/logger";

const PK_API_BASE_URL = "https://api.pluralkit.me/v2";

/** Overall retry budget for a single message lookup, in milliseconds (default: 5000) */
const LOOKUP_TIMEOUT_MS = Number.parseInt(process.env.PLURALKIT_LOOKUP_TIMEOUT_MS || "5000", 10);

/**
 * Optional bot-owned PK token, sent as-is in the Authorization header (no "Bearer"
 * prefix — this is PluralKit's own convention, not OAuth). Raises the base rate
 * limit for all lookups; grants no access to other users' private data.
 */
const API_TOKEN = process.env.PLURALKIT_API_TOKEN || undefined;

/** Backoff schedule between retries, in ms — PK's message index lags ~2s behind proxied sends */
const RETRY_DELAYS_MS = [800, 1600, 3200];

/** Cap on permanently-cached resolved identities (a message's identity never changes once known) */
const IDENTITY_CACHE_MAX_ENTRIES = 2000;

/** PluralKit system fields we consume from the message-lookup payload */
export interface PkSystemInfo {
  /** Short-form system hid (5-7 chars, e.g. "abcdef") — stored alongside the UUID, never used as the key */
  id: string;
  /** Canonical system anchor — never key on name, it's volatile */
  uuid: string;
  /** Cosmetic display name; may be null/absent when the system keeps it private */
  name?: string | null;
  /** Cosmetic system tag; may be null/absent when the system keeps it private */
  tag?: string | null;
}

/** PluralKit member fields we consume from the message-lookup payload */
export interface PkMemberInfo {
  /** Short-form member hid (5-7 chars, e.g. "ghijkl") — stored alongside the UUID, never used as the key */
  id: string;
  /** Canonical member anchor — never key on name, it's volatile */
  uuid: string;
  name: string;
  /** Cosmetic display name; falls back to `name` when unset */
  display_name?: string | null;
}

/** Resolved PluralKit identity behind a proxied webhook message */
export interface PkMessageLookup {
  /** The original (pre-proxy, now-deleted) message's Discord snowflake ID */
  original: string;
  /** The host Discord account snowflake that sent/proxied the message — authorization keys off this, never the member */
  sender: string;
  /** The fronting member's system, or null if the member (and thus its system) was deleted */
  system: PkSystemInfo | null;
  /** The fronting member, or null if deleted — treat as an unproxied webhook with no identity claims */
  member: PkMemberInfo | null;
}

/** Raw PK API response shape for `GET /messages/{id}` (subset of fields we use) */
interface PkApiMessageResponse {
  original?: string;
  sender: string;
  system?: PkSystemInfo | null;
  member?: PkMemberInfo | null;
}

// Single-flight + permanent cache: a message's PK identity is immutable once
// resolved, so successful lookups never need to be refetched. Transient
// failures (network errors, exhausted retries) are deliberately NOT cached —
// caching them would permanently poison a message that PK could resolve fine
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

/** Parses a `Retry-After` header (seconds) into milliseconds; null if missing/invalid */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number.parseFloat(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
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
 * error — callers must fall through to today's plain-webhook behavior in
 * that case, never inventing an identity.
 */
async function fetchWithRetry(messageId: string, deadline: number): Promise<PkMessageLookup | null> {
  let attempt = 0;

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      log.warn(
        `PluralKit lookup for message ${messageId} exceeded the ${LOOKUP_TIMEOUT_MS}ms budget; treating as unproxied`,
      );
      return null;
    }

    try {
      const headers: Record<string, string> = {};
      if (API_TOKEN) headers.Authorization = API_TOKEN;

      const response = await fetch(`${PK_API_BASE_URL}/messages/${messageId}`, {
        headers,
        signal: AbortSignal.timeout(remainingMs),
      });

      if (response.ok) {
        const raw = (await response.json()) as PkApiMessageResponse;
        return toMessageLookup(raw, messageId);
      }

      // 404: PK's message index lags ~2s behind proxied sends — retry within budget.
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
 * returns a non-retryable error — callers must fall through to today's
 * plain-webhook behavior in that case.
 *
 * Successful lookups are cached permanently in-process (a message's
 * identity never changes) under an LRU-style eviction cap; concurrent
 * calls for the same message share one in-flight request.
 *
 * @param messageId - The webhook (proxy repost) message's Discord snowflake ID
 * @returns The resolved identity, or null if PK has no data / is unreachable
 */
export async function fetchMessage(messageId: string): Promise<PkMessageLookup | null> {
  const cached = identityCache.get(messageId);
  if (cached) return cached;

  const existing = inFlightLookups.get(messageId);
  if (existing) return existing;

  const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
  const lookupPromise = fetchWithRetry(messageId, deadline)
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
