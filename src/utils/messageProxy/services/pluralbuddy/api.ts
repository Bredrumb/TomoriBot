import { z } from "zod";
import { log } from "@/utils/misc/logger";

const API_ORIGIN = "https://pluralbuddy.app";
const LOOKUP_TIMEOUT_MS = 5000;
const RETRY_DELAYS_MS = [500, 1000, 1500] as const;
const CACHE_LIMIT = 2000;
const snowflake = z.string().regex(/^\d{17,20}$/);
const responseSchema = z.object({
  message: z
    .object({
      messageId: snowflake,
      systemId: snowflake,
      alterId: z.number().positive(),
      channelId: snowflake,
      referencedMessage: snowflake.optional(),
    })
    .nullable(),
});
const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

export type PluralBuddyMessage = NonNullable<z.infer<typeof responseSchema>["message"]> & {
  alterIdKey: string;
};

let token: { value: string; expiresAt: number } | null = null;
let pendingToken: Promise<string | null> | null = null;
const cache = new Map<string, PluralBuddyMessage>();
const pending = new Map<string, Promise<PluralBuddyMessage | null>>();
let warnedMissingCredentials = false;

async function getAccessToken(deadline: number): Promise<string | null> {
  if (token && token.expiresAt > Date.now() + 30_000) return token.value;
  if (pendingToken) return pendingToken;
  const clientId = process.env.PLURALBUDDY_CLIENT_ID?.trim();
  const clientSecret = process.env.PLURALBUDDY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    if (!warnedMissingCredentials) {
      log.warn("PluralBuddy message lookup requires PLURALBUDDY_CLIENT_ID and PLURALBUDDY_CLIENT_SECRET");
      warnedMissingCredentials = true;
    }
    return null;
  }
  pendingToken = (async () => {
    try {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        resource: API_ORIGIN,
      });
      const response = await fetch(`${API_ORIGIN}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      if (!response.ok) {
        log.warn(`PluralBuddy token request failed with status ${response.status}`);
        return null;
      }
      const parsed = tokenSchema.safeParse(await response.json());
      if (!parsed.success) return null;
      token = {
        value: parsed.data.access_token,
        expiresAt: Date.now() + parsed.data.expires_in * 1000,
      };
      return token.value;
    } catch (error) {
      log.warn("PluralBuddy token request failed", error);
      return null;
    } finally {
      pendingToken = null;
    }
  })();
  return pendingToken;
}

async function lookUp(messageId: string): Promise<PluralBuddyMessage | null> {
  const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const accessToken = await getAccessToken(deadline);
    if (!accessToken) return null;
    try {
      const response = await fetch(`${API_ORIGIN}/api/v1/messages/${messageId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      if (response.status === 401) {
        token = null;
        return null;
      }
      if (response.status === 429) {
        log.warn("PluralBuddy message lookup was rate limited");
        return null;
      }
      if (response.ok) {
        const rawText = await response.text();
        let raw: unknown;
        try {
          raw = JSON.parse(rawText);
        } catch {
          return null;
        }
        const parsed = responseSchema.safeParse(raw);
        if (!parsed.success) {
          log.warn(`PluralBuddy message lookup for ${messageId} returned an invalid payload`);
          return null;
        }
        if (parsed.data.message) {
          const exactAlterId = rawText.match(/"alterId"\s*:\s*(\d{1,20})\b/)?.[1];
          if (!exactAlterId || Number(exactAlterId) !== parsed.data.message.alterId) return null;
          if (parsed.data.message.messageId !== messageId) return null;
          return { ...parsed.data.message, alterIdKey: exactAlterId };
        }
      }
      if (!response.ok && response.status !== 404) {
        log.warn(`PluralBuddy message lookup failed with status ${response.status}`);
        return null;
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        log.warn(`PluralBuddy message lookup for ${messageId} timed out`, error);
        return null;
      }
    }
    const delay = Math.min(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)], deadline - Date.now());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return null;
}

export async function fetchPluralBuddyMessage(messageId: string): Promise<PluralBuddyMessage | null> {
  if (!snowflake.safeParse(messageId).success) return null;
  const cached = cache.get(messageId);
  if (cached) return cached;
  const inFlight = pending.get(messageId);
  if (inFlight) return inFlight;
  const lookup = lookUp(messageId)
    .then((result) => {
      if (result) {
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value ?? "");
        cache.set(messageId, result);
      }
      return result;
    })
    .finally(() => pending.delete(messageId));
  pending.set(messageId, lookup);
  return lookup;
}

export function getCachedPluralBuddyMessage(messageId: string): PluralBuddyMessage | null {
  return cache.get(messageId) ?? null;
}

export function clearPluralBuddyApiStateForTests(): void {
  token = null;
  pendingToken = null;
  cache.clear();
  pending.clear();
  warnedMissingCredentials = false;
}
