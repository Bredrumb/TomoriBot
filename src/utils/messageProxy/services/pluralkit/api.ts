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

/** Backoff schedule between retries, in ms; PK's message index lags ~2s behind proxied sends */
const RETRY_DELAYS_MS = [800, 1600, 3200];

/**
 * Share of the overall budget one attempt may spend before it is aborted. A stalled
 * connection otherwise consumes the whole deadline and leaves nothing for the retry
 * that recovers a transient stall. Half keeps a retry funded at the default 5s budget:
 * the first attempt aborts at 2.5s, the first backoff step costs 800ms, and the retry
 * still has roughly 1.7s to answer.
 */
const ATTEMPT_BUDGET_SHARE = 0.5;

/**
 * Shortest attempt worth starting. It also caps every retry sleep, so a retry always
 * keeps a usable slice of the deadline and a transport that fails instantly cannot
 * spin attempts inside the same millisecond.
 */
const MIN_ATTEMPT_TIMEOUT_MS = 500;

/** Cap on permanently-cached resolved identities (a message's identity never changes once known) */
const IDENTITY_CACHE_MAX_ENTRIES = 2000;

/**
 * A lookup that could not be completed: stalled transport, network failure, rate
 * limit, or an untrustworthy response. Resolving `null` instead means PluralKit
 * answered that it has no such message, so the router reports this failure as
 * timeout/error rather than as a confirmed miss.
 */
export class PluralKitLookupUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "PluralKitLookupUnavailableError";
  }
}

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
  // Public pronouns only. PluralKit omits or nulls this key when the member keeps
  // pronouns private, so a value here is always the member's own public claim.
  pronouns: z.string().nullable().optional(),
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

/** Logs the failure and reports it to the router as a transport error, never as a miss. */
function failLookup(messageId: string, reason: string, cause?: unknown): never {
  log.warn(`PluralKit lookup for message ${messageId} ${reason}`, cause);
  throw new PluralKitLookupUnavailableError(`PluralKit lookup for message ${messageId} ${reason}`, cause);
}

/**
 * Ends a lookup whose budget ran out. PK's last authoritative answer decides the
 * outcome: a 404 already said the message is unknown, so that miss stands, while any
 * other exhaustion leaves the message unresolved.
 */
function endExhaustedLookup(
  messageId: string,
  lastAnswerWasMiss: boolean,
  reason: string,
  cause?: unknown,
): PkMessageLookup | null {
  if (lastAnswerWasMiss) {
    log.warn(`PluralKit lookup for message ${messageId} ${reason}; PK reports no such message`);
    return null;
  }
  return failLookup(messageId, reason, cause);
}

/**
 * Sleeps out a retry delay, or reports that the deadline cannot fund another attempt.
 * The delay is trimmed so the retry keeps `MIN_ATTEMPT_TIMEOUT_MS` of its own.
 */
async function waitBeforeRetry(deadline: number, delayMs: number): Promise<boolean> {
  const availableMs = deadline - Date.now() - MIN_ATTEMPT_TIMEOUT_MS;
  if (availableMs <= 0) return false;
  await sleep(Math.min(delayMs, availableMs));
  return true;
}

function backoffMsForAttempt(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

/**
 * Attempts the PK message lookup with retries, bounded by `deadline`.
 *
 * Returns null only when PK answered that it has no such message, because callers
 * must fall through to today's plain-webhook behavior in that case, never inventing
 * an identity. Every other way of running out of budget or trust throws
 * `PluralKitLookupUnavailableError`.
 */
async function fetchWithRetry(
  messageId: string,
  deadline: number,
  lookupTimeoutMs: number,
): Promise<PkMessageLookup | null> {
  const attemptCapMs = Math.max(Math.floor(lookupTimeoutMs * ATTEMPT_BUDGET_SHARE), MIN_ATTEMPT_TIMEOUT_MS);
  const headers: Record<string, string> = {};
  // Optional bot-owned PK token, sent as-is (no "Bearer" prefix: PluralKit's own
  // convention, not OAuth). It raises the base rate limit for all lookups and grants
  // no access to other users' private data.
  const apiToken = process.env.PLURALKIT_API_TOKEN?.trim();
  if (apiToken) headers.Authorization = apiToken;

  let attempt = 0;
  /** PK's most recent authoritative answer. Only a 404 is one. */
  let lastAnswerWasMiss = false;

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return endExhaustedLookup(messageId, lastAnswerWasMiss, `exceeded the ${lookupTimeoutMs}ms budget`);
    }

    let response: Response;
    const signal = AbortSignal.timeout(Math.min(remainingMs, attemptCapMs));
    try {
      response = await fetch(`${PK_API_BASE_URL}/messages/${messageId}`, {
        headers,
        signal,
      });
    } catch (error) {
      if (!(await waitBeforeRetry(deadline, backoffMsForAttempt(attempt)))) {
        return endExhaustedLookup(
          messageId,
          lastAnswerWasMiss,
          `exceeded the ${lookupTimeoutMs}ms budget after a stalled attempt`,
          error,
        );
      }
      attempt++;
      continue;
    }

    if (response.ok) {
      let raw: unknown;
      try {
        raw = await response.json();
      } catch (error) {
        if (signal.aborted) {
          if (!(await waitBeforeRetry(deadline, backoffMsForAttempt(attempt)))) {
            return endExhaustedLookup(
              messageId,
              lastAnswerWasMiss,
              `exceeded the ${lookupTimeoutMs}ms budget after a stalled response body`,
              error,
            );
          }
          attempt++;
          continue;
        }
        return failLookup(messageId, "returned malformed JSON", error);
      }
      const parsed = pkApiMessageResponseSchema.safeParse(raw);
      if (!parsed.success) {
        return failLookup(messageId, "returned an invalid payload");
      }
      return toMessageLookup(parsed.data, messageId);
    }

    // 404: PK's message index lags ~2s behind proxied sends, so retry within budget.
    // 429: honor Retry-After when sane, otherwise fall back to the backoff schedule.
    if (response.status === 404 || response.status === 429) {
      lastAnswerWasMiss = response.status === 404;
      const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response.headers.get("Retry-After")) : null;
      // A Retry-After that cannot be honored with room left for another attempt is the
      // server saying not to come back inside this budget: retrying early would ignore
      // the rate limit, and sleeping it out would only stall this admission.
      if (retryAfterMs !== null && retryAfterMs > deadline - Date.now() - MIN_ATTEMPT_TIMEOUT_MS) {
        return failLookup(messageId, `was rate limited for ${Math.round(retryAfterMs)}ms, beyond its remaining budget`);
      }
      if (!(await waitBeforeRetry(deadline, retryAfterMs ?? backoffMsForAttempt(attempt)))) {
        return endExhaustedLookup(
          messageId,
          lastAnswerWasMiss,
          `exceeded the ${lookupTimeoutMs}ms budget while retrying after status ${response.status}`,
        );
      }
      attempt++;
      continue;
    }

    return failLookup(messageId, `failed with status ${response.status}`);
  }
}

/**
 * Resolves the PluralKit identity behind a webhook message (the proxy
 * repost), via `GET /v2/messages/{messageId}`.
 *
 * Retries 404s (PK indexing lag) and 429s (honoring `Retry-After`) on an
 * exponential backoff schedule, bounded by `PLURALKIT_LOOKUP_TIMEOUT_MS`
 * (default 5000ms). No single attempt may spend the whole budget, so a stalled
 * connection is aborted with enough time left for one retry.
 *
 * Returns null once PK reports that it has no such message, because callers must
 * fall through to today's plain-webhook behavior in that case. Any other
 * unresolved outcome throws `PluralKitLookupUnavailableError`, which the router
 * counts as timeout/error instead of a miss.
 *
 * Successful lookups are cached permanently in-process (a message's
 * identity never changes) under an LRU-style eviction cap; concurrent
 * calls for the same message share one in-flight request. A failed lookup is
 * never cached, so a later call can still succeed.
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
