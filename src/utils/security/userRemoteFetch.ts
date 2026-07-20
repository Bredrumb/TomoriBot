import { isIP } from "node:net";
import {
  Agent,
  fetch as undiciFetch,
  type RequestInfo as UndiciRequestInfo,
  type RequestInit as UndiciRequestInit,
  type Response as UndiciResponse,
} from "undici/index.js";
import { validateRemoteMcpUrl } from "@/utils/mcp/mcpUrlSecurity";

export interface PinnedDnsRecord {
  address: string;
  family: 4 | 6;
  ttl: number;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const USER_REMOTE_FETCH_MAX_REDIRECTS = readPositiveIntegerEnv("USER_REMOTE_FETCH_MAX_REDIRECTS", 3);

function isRequestLike(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function mergeHeaders(baseHeaders?: HeadersInit, overrideHeaders?: HeadersInit): Headers {
  const headers = new Headers(baseHeaders);
  if (!overrideHeaders) {
    return headers;
  }

  const overrides = new Headers(overrideHeaders);
  overrides.forEach((value, key) => {
    headers.set(key, value);
  });
  return headers;
}

async function normalizeRequestInput(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{
  url: URL;
  requestInit: RequestInit;
}> {
  if (!isRequestLike(input)) {
    return {
      url: input instanceof URL ? new URL(input.toString()) : new URL(input),
      requestInit: { ...(init ?? {}) },
    };
  }

  const method = init?.method ?? input.method;
  let body = init?.body;
  if (body === undefined && !["GET", "HEAD"].includes(method.toUpperCase())) {
    body = await input.clone().arrayBuffer();
  }

  return {
    url: new URL(input.url),
    requestInit: {
      method,
      headers: mergeHeaders(input.headers, init?.headers),
      body,
      redirect: init?.redirect ?? input.redirect,
      signal: init?.signal ?? input.signal,
      credentials: init?.credentials ?? input.credentials,
      keepalive: init?.keepalive ?? input.keepalive,
      mode: init?.mode ?? input.mode,
      referrer: init?.referrer ?? input.referrer,
      referrerPolicy: init?.referrerPolicy ?? input.referrerPolicy,
      integrity: init?.integrity ?? input.integrity,
    },
  };
}

function toPinnedDnsRecords(addresses: string[]): PinnedDnsRecord[] {
  return addresses
    .map((address) => {
      const family = isIP(address);
      if (family !== 4 && family !== 6) {
        return null;
      }

      return {
        address,
        family,
        ttl: 1,
      } satisfies PinnedDnsRecord;
    })
    .filter((entry): entry is PinnedDnsRecord => entry !== null);
}

export function createPinnedDispatcher(records: PinnedDnsRecord[]): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) {
          callback(null, records);
          return;
        }

        const [record] = records;
        callback(null, record.address, record.family);
      },
    },
  });
}

export async function closePinnedDispatcher(dispatcher: Agent): Promise<void> {
  const compatibleDispatcher = dispatcher as unknown as {
    close?: () => Promise<void>;
    destroy?: () => Promise<void> | void;
  };

  if (typeof compatibleDispatcher.close === "function") {
    await compatibleDispatcher.close();
  } else if (typeof compatibleDispatcher.destroy === "function") {
    await compatibleDispatcher.destroy();
  }
}

function isRedirectStatus(status: number): status is 301 | 302 | 303 | 307 | 308 {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function buildRedirectRequestInit(requestInit: RequestInit, status: number): RequestInit {
  const currentMethod = (requestInit.method ?? "GET").toUpperCase();
  const headers = mergeHeaders(requestInit.headers);

  if (status === 303 || ((status === 301 || status === 302) && currentMethod === "POST")) {
    headers.delete("content-length");
    headers.delete("content-type");
    headers.delete("transfer-encoding");

    return {
      ...requestInit,
      method: "GET",
      body: undefined,
      headers,
    };
  }

  return {
    ...requestInit,
    headers,
  };
}

export async function resolveValidatedUserRedirect(
  currentUrl: URL,
  location: string,
  strict: boolean,
  allowPrivateNetwork = false,
): Promise<URL> {
  const nextUrl = new URL(location, currentUrl);
  const validation = await validateRemoteMcpUrl(nextUrl.toString(), { strict, allowPrivateNetwork });
  if (!validation.valid) {
    throw new Error(validation.details ?? `Remote redirect validation failed for '${nextUrl.hostname}'.`);
  }
  return nextUrl;
}

async function fetchUserRemoteUrlInternal(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  redirectCount: number,
  strict: boolean,
  allowPrivateNetwork: boolean,
): Promise<Response> {
  const { url, requestInit } = await normalizeRequestInput(input, init);
  const validation = await validateRemoteMcpUrl(url.toString(), { strict, allowPrivateNetwork });
  if (!validation.valid) {
    throw new Error(validation.details ?? `Remote URL validation failed for '${url.hostname}'.`);
  }

  const redirectPolicy = requestInit.redirect ?? "follow";
  const pinnedRecords = toPinnedDnsRecords(validation.resolvedAddresses ?? []);
  const dispatcher =
    isIP(url.hostname) === 0 && pinnedRecords.length > 0 ? createPinnedDispatcher(pinnedRecords) : null;

  if (isIP(url.hostname) === 0 && !dispatcher) {
    throw new Error(`Remote URL validation did not return a pinnable address for '${url.hostname}'.`);
  }

  try {
    const response = await undiciFetch(url as unknown as UndiciRequestInfo, {
      ...(requestInit as unknown as UndiciRequestInit),
      redirect: "manual",
      dispatcher: dispatcher ?? undefined,
    });

    if (!isRedirectStatus(response.status)) {
      return response as unknown as Response;
    }

    if (redirectPolicy === "manual") {
      return response as unknown as Response;
    }

    await response.body?.cancel();

    if (redirectPolicy === "error") {
      throw new Error(`Redirects are not allowed for user-supplied URL '${url.toString()}'.`);
    }

    if (redirectCount >= USER_REMOTE_FETCH_MAX_REDIRECTS) {
      throw new Error(`Too many redirects while fetching '${url.toString()}'.`);
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`Redirect response from '${url.toString()}' did not include a Location header.`);
    }

    const nextUrl = await resolveValidatedUserRedirect(url, location, strict, allowPrivateNetwork);
    return await fetchUserRemoteUrlInternal(
      nextUrl,
      buildRedirectRequestInit(requestInit, response.status),
      redirectCount + 1,
      strict,
      allowPrivateNetwork,
    );
  } finally {
    if (dispatcher) {
      await closePinnedDispatcher(dispatcher).catch(() => undefined);
    }
  }
}

export interface FetchUserRemoteUrlOptions {
  /** Enforce the private/link-local/loopback blocklist even outside production.
   *  Pass true for personal (user-scoped) endpoint calls. */
  strict?: boolean;
  /** Permit private/internal targets even in production, aligning with the
   *  `fetch_url` `FETCH_URL_ALLOW_PRIVATE_NETWORK` opt-in. The always-on
   *  cloud-metadata denylist still applies. Ignored when `strict` is set. */
  allowPrivateNetwork?: boolean;
}

export async function fetchUserRemoteUrl(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: FetchUserRemoteUrlOptions,
): Promise<Response> {
  return await fetchUserRemoteUrlInternal(
    input,
    init,
    0,
    options?.strict === true,
    options?.allowPrivateNetwork === true,
  );
}

export const fetchUserRemoteUrlUndici: typeof undiciFetch = async (
  input: UndiciRequestInfo,
  init?: UndiciRequestInit,
): Promise<UndiciResponse> =>
  (await fetchUserRemoteUrl(
    input as unknown as RequestInfo | URL,
    init as unknown as RequestInit,
  )) as unknown as UndiciResponse;
