import { createHash } from "node:crypto";
import { currentStoredCredentialActivity } from "@/utils/provider/providerUsage";
import { recordStoredCredentialRequest } from "@/utils/security/apiKeyRetention";
import { z } from "zod";
import { readBoundedResponse } from "@/utils/security/boundedResponse";

export interface ProviderRequestHold {
  reportCost(cost: number | null | undefined): void;
  release(retainEstimate?: boolean): void;
}

export interface ProviderRequestContext {
  apiKey: string;
  path: string;
  body: Record<string, unknown>;
}

export type ProviderRequestHook = (
  context: ProviderRequestContext,
) => ProviderRequestHold | undefined | Promise<ProviderRequestHold | undefined>;

const JSON_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
const BEARER_PREFIX = "Bearer ";
const reportedCostSchema = z.object({
  usage: z.object({ cost: z.number().finite().nonnegative().nullish() }).nullish(),
  error: z.unknown().optional(),
});

let requestHook: ProviderRequestHook | undefined;

export function registerProviderRequestHook(hook: ProviderRequestHook): () => void {
  const previous = requestHook;
  requestHook = hook;
  return () => {
    if (requestHook === hook) requestHook = previous;
  };
}

export function hasProviderRequestHook(): boolean {
  return requestHook !== undefined;
}

export async function beginProviderRequest(context: ProviderRequestContext): Promise<ProviderRequestHold | undefined> {
  return requestHook?.(context);
}

export async function fetchWithProviderRequest(
  input: string | URL | Request,
  init?: RequestInit,
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
): Promise<Response> {
  const hook = requestHook;
  const request = input instanceof Request ? input : null;
  const send = () => (init === undefined ? fetchImpl(input) : fetchImpl(input, init));
  if (!hook || (init?.method ?? request?.method)?.toUpperCase() !== "POST") return send();
  const signal = init?.signal ?? request?.signal;
  signal?.throwIfAborted();
  const bodyText = typeof init?.body === "string" ? init.body : await request?.clone().text();
  const body = JSON.parse(bodyText ?? "") as Record<string, unknown>;
  const authorization = new Headers(init?.headers ?? request?.headers).get("Authorization");
  const hold = await hook({
    apiKey: authorization?.startsWith(BEARER_PREFIX) ? authorization.slice(BEARER_PREFIX.length) : "",
    path: new URL(request?.url ?? String(input)).pathname,
    body,
  });
  if (!hold) return send();
  let retainEstimate = false;
  try {
    signal?.throwIfAborted();
    const response = await send();
    if (!response.ok) hold.reportCost(0);
    const responseBody = await readBoundedResponse(response, JSON_RESPONSE_MAX_BYTES, signal ?? undefined);
    if (response.ok) {
      try {
        const parsed = reportedCostSchema.safeParse(JSON.parse(responseBody.toString("utf8")));
        if (parsed.success) {
          hold.reportCost(parsed.data.usage?.cost);
          retainEstimate = parsed.data.error === undefined;
        }
      } catch {}
    }
    return new Response(new Uint8Array(responseBody), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    if (signal?.aborted) hold.reportCost(0);
    throw error;
  } finally {
    hold.release(retainEstimate);
  }
}

export function createCredentialActivityFetch(delegate: typeof fetch): typeof fetch {
  return Object.assign(async (input: string | URL | Request, init?: BunFetchRequestInit): Promise<Response> => {
    const activity = currentStoredCredentialActivity();
    if (activity) {
      const request = input instanceof Request ? input : null;
      (init?.signal ?? request?.signal)?.throwIfAborted();
      const headers = new Headers(init?.headers ?? request?.headers);
      const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const url = new URL(request?.url ?? String(input));
      const candidates = [bearer, url.searchParams.get("key")];
      for (const name of ["x-api-key", "x-goog-api-key", "xi-api-key", "x-subscription-token"]) {
        candidates.push(headers.get(name));
      }
      const key = candidates.find(
        (candidate) => candidate && createHash("sha256").update(candidate).digest("hex") === activity.requestKeyDigest,
      );
      if (key) await recordStoredCredentialRequest(key);
    }
    return delegate(input, init);
  }, delegate);
}

let activityFetchInstalled = false;

export function initializeCredentialActivityFetch(): void {
  if (activityFetchInstalled) return;
  // The Google SDK exposes no asynchronous pre-dispatch hook, so its requests use the same fetch gate as direct HTTP adapters.
  globalThis.fetch = createCredentialActivityFetch(globalThis.fetch);
  activityFetchInstalled = true;
}
