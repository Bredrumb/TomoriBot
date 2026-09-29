import { z } from "zod";
import { canonicalMessageProxyOrigin, type MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import {
  getPluralBuddyAccessToken,
  rejectPluralBuddyAccessToken,
} from "@/utils/messageProxy/services/pluralbuddy/oauthTokens";
import { log } from "@/utils/misc/logger";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";

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
      referencedMessage: snowflake.nullish(),
    })
    .nullable(),
});

export type PluralBuddyMessage = NonNullable<z.infer<typeof responseSchema>["message"]> & {
  alterIdKey: string;
};

const cache = new Map<string, PluralBuddyMessage>();
const pending = new Map<string, Promise<PluralBuddyMessage | null>>();

function validInstance(instance: MessageProxyInstanceContext): boolean {
  return instance.serviceId === "pluralbuddy" && canonicalMessageProxyOrigin(instance.origin) === instance.origin;
}

function lookupKey(instance: MessageProxyInstanceContext, messageId: string): string {
  return `${instance.instanceId}\0${instance.origin}\0${messageId}`;
}

async function lookUp(instance: MessageProxyInstanceContext, messageId: string): Promise<PluralBuddyMessage | null> {
  const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const accessToken = await getPluralBuddyAccessToken(instance);
    if (!accessToken || Date.now() >= deadline) return null;
    try {
      const response = await fetchUserRemoteUrl(
        `${instance.origin}/api/v1/messages/${messageId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          redirect: "manual",
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        },
        { strict: true },
      );
      if (response.status === 401) {
        await rejectPluralBuddyAccessToken(instance, accessToken);
        return null;
      }
      if (response.status === 429) {
        log.warn("PluralBuddy message lookup was rate limited", undefined, {
          metadata: { instanceId: instance.instanceId },
        });
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
          log.warn("PluralBuddy message lookup returned an invalid payload", undefined, {
            metadata: {
              instanceId: instance.instanceId,
              // Paths and codes only: issue messages can echo response values.
              issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}:${issue.code}`),
            },
          });
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
        log.warn("PluralBuddy message lookup failed", undefined, {
          metadata: { instanceId: instance.instanceId, status: response.status },
        });
        return null;
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        log.warn("PluralBuddy message lookup timed out", undefined, {
          metadata: { instanceId: instance.instanceId, errorClass: error instanceof Error ? error.name : "unknown" },
        });
        return null;
      }
    }
    const delay = Math.min(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)], deadline - Date.now());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return null;
}

export async function fetchPluralBuddyMessage(
  instance: MessageProxyInstanceContext,
  messageId: string,
): Promise<PluralBuddyMessage | null> {
  if (!validInstance(instance) || !snowflake.safeParse(messageId).success) return null;
  const key = lookupKey(instance, messageId);
  const cached = cache.get(key);
  if (cached) return cached;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const lookup = lookUp(instance, messageId)
    .then((result) => {
      if (result) {
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value ?? "");
        cache.set(key, result);
      }
      return result;
    })
    .finally(() => pending.delete(key));
  pending.set(key, lookup);
  return lookup;
}

export function getCachedPluralBuddyMessage(
  instance: MessageProxyInstanceContext,
  messageId: string,
): PluralBuddyMessage | null {
  if (!validInstance(instance)) return null;
  return cache.get(lookupKey(instance, messageId)) ?? null;
}

export function clearPluralBuddyApiStateForTests(): void {
  cache.clear();
  pending.clear();
}
