/**
 * The single SSRF gate for user-supplied URLs.
 *
 * Guards guild MCP servers, guild and personal custom endpoints, and every
 * `safeDownload()` caller through `fetchUserRemoteUrl()`. `fetch_url` runs its own
 * parallel guard in `src/tools/fetchUrl/urlSafety.ts` because the Crawl4AI engine
 * dispatches out-of-process. Its in-process `safe_http` engine still reaches this gate, with
 * `strict` unless the operator set `FETCH_URL_ALLOW_PRIVATE_NETWORK`.
 *
 * Outside production, private targets are admitted unless the operator sets
 * `ALLOW_PRIVATE_NETWORK=false`, so self-hosted local model servers work without setup. Production
 * always refuses them because the hosted instance serves untrusted communities.
 *
 * Add new user-URL entry points here rather than writing a third guard.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isCloudMetadataAddress } from "@/utils/security/cloudMetadata";
import { getEmbeddedIpv4 } from "@/utils/security/embeddedIpv4";

export type RemoteUrlValidationFailureCode =
  | "INVALID_FORMAT"
  | "INVALID_PROTOCOL"
  | "REMOTE_HTTP_FORBIDDEN"
  | "PRODUCTION_HTTPS_REQUIRED"
  | "PRODUCTION_LOCALHOST_FORBIDDEN"
  | "DNS_RESOLUTION_FAILED"
  | "PRODUCTION_BLOCKED_ADDRESS";

interface ResolvedRemoteAddress {
  address: string;
  family: number;
  blockedInProduction: boolean;
  reason: string;
}

export interface RemoteUrlValidationResult {
  valid: boolean;
  hostname?: string;
  resolvedAddresses?: string[];
  failureCode?: RemoteUrlValidationFailureCode;
  blockedAddress?: string;
  /** Diagnostic text for logs and thrown errors only. This gate backs MCP config,
   *  custom endpoints, `fetch_url`, and every `safeDownload`, so it cannot know what
   *  the caller was doing: keep this caller-neutral and put user-facing remediation
   *  in the caller, keyed off `failureCode`. */
  details?: string;
}

const PRIVATE_NETWORK_ENV = "ALLOW_PRIVATE_NETWORK";

function isProductionRuntime(): boolean {
  return process.env.RUN_ENV === "production";
}

/** Unset means on, while an unrecognized value means off, so a typo fails closed. */
function isEndpointPrivateNetworkAllowed(): boolean {
  if (isProductionRuntime()) return false;
  const raw = process.env[PRIVATE_NETWORK_ENV]?.trim().toLowerCase();
  if (!raw) return true;
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, "");
}

function normalizeResolvedAddress(address: string): string {
  const normalized = address.trim().toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    if (isIP(mappedIpv4) === 4) {
      return mappedIpv4;
    }
  }

  return normalized;
}

function isExplicitLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function classifyIpv4Address(address: string): {
  blockedInProduction: boolean;
  reason: string;
} {
  const octets = address.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
    return {
      blockedInProduction: true,
      reason: "not a valid IPv4 address",
    };
  }

  const [first, second, third] = octets;

  if (first === 10) {
    return { blockedInProduction: true, reason: "a private IPv4 range" };
  }
  if (first === 127) {
    return { blockedInProduction: true, reason: "a loopback IPv4 address" };
  }
  if (first === 0) {
    return {
      blockedInProduction: true,
      reason: "a non-routable IPv4 address",
    };
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return { blockedInProduction: true, reason: "a private IPv4 range" };
  }
  if (first === 192 && second === 168) {
    return { blockedInProduction: true, reason: "a private IPv4 range" };
  }
  if (first === 169 && second === 254) {
    return { blockedInProduction: true, reason: "a link-local IPv4 address" };
  }
  if (first === 100 && second >= 64 && second <= 127) {
    return {
      blockedInProduction: true,
      reason: "a carrier-grade NAT IPv4 range",
    };
  }
  if (first === 198 && (second === 18 || second === 19)) {
    return {
      blockedInProduction: true,
      reason: "a benchmarking IPv4 range",
    };
  }
  if (first === 192 && second === 0 && (third === 0 || third === 2)) {
    return {
      blockedInProduction: true,
      reason: "a reserved IPv4 range",
    };
  }
  if (first === 198 && second === 51 && third === 100) {
    return {
      blockedInProduction: true,
      reason: "a documentation IPv4 range",
    };
  }
  if (first === 203 && second === 0 && third === 113) {
    return {
      blockedInProduction: true,
      reason: "a documentation IPv4 range",
    };
  }
  if (first >= 224) {
    return {
      blockedInProduction: true,
      reason: "a multicast or reserved IPv4 range",
    };
  }

  return { blockedInProduction: false, reason: "a public IPv4 address" };
}

function classifyIpv6Address(address: string): {
  blockedInProduction: boolean;
  reason: string;
} {
  if (address === "::") {
    return {
      blockedInProduction: true,
      reason: "an unspecified IPv6 address",
    };
  }
  if (address === "::1") {
    return { blockedInProduction: true, reason: "a loopback IPv6 address" };
  }
  // Classify by the embedded IPv4 but keep the IPv6 address, because the fetch pins to it and an
  // IPv6-only host behind NAT64 cannot dial the IPv4 directly.
  const embeddedIpv4 = getEmbeddedIpv4(address);
  if (embeddedIpv4) {
    return classifyIpv4Address(embeddedIpv4);
  }
  if (/^f[cd]/.test(address)) {
    return { blockedInProduction: true, reason: "a unique-local IPv6 range" };
  }
  if (/^fe[89ab]/.test(address)) {
    return { blockedInProduction: true, reason: "a link-local IPv6 range" };
  }
  if (/^ff/.test(address)) {
    return { blockedInProduction: true, reason: "a multicast IPv6 range" };
  }
  if (/^2001:db8(?::|$)/.test(address)) {
    return {
      blockedInProduction: true,
      reason: "a documentation IPv6 range",
    };
  }

  return { blockedInProduction: false, reason: "a public IPv6 address" };
}

function classifyResolvedAddress(address: string): ResolvedRemoteAddress {
  const normalizedAddress = normalizeResolvedAddress(address);
  const family = isIP(normalizedAddress);

  if (family === 4) {
    const classification = classifyIpv4Address(normalizedAddress);
    return {
      address: normalizedAddress,
      family,
      ...classification,
    };
  }

  if (family === 6) {
    const classification = classifyIpv6Address(normalizedAddress);
    return {
      address: normalizedAddress,
      family,
      ...classification,
    };
  }

  return {
    address: normalizedAddress,
    family,
    blockedInProduction: true,
    reason: "not a recognized IP address",
  };
}

async function resolveHostnameAddresses(hostname: string): Promise<ResolvedRemoteAddress[]> {
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    return [classifyResolvedAddress(hostname)];
  }

  const resolved = await lookup(hostname, {
    all: true,
    verbatim: true,
  });

  const addresses = new Map<string, ResolvedRemoteAddress>();
  for (const entry of resolved) {
    const classified = classifyResolvedAddress(entry.address);
    addresses.set(classified.address, classified);
  }

  return Array.from(addresses.values());
}

function getPrivateNetworkRemedy(strict: boolean): string {
  if (strict) return "";
  return isProductionRuntime()
    ? " Production always blocks private addresses."
    : ` The host blocks private addresses with ${PRIVATE_NETWORK_ENV}=false.`;
}

function buildBlockedAddressDetails(
  hostname: string,
  blockedAddress: ResolvedRemoteAddress,
  allAddresses: ResolvedRemoteAddress[],
  strict: boolean,
): string {
  const resolvedList = allAddresses.map((entry) => entry.address).join(", ");
  return (
    `Resolved address '${blockedAddress.address}' for '${hostname}' is ${blockedAddress.reason}. ` +
    `Only publicly routable hosts are allowed. Resolved addresses: ${resolvedList}.` +
    getPrivateNetworkRemedy(strict)
  );
}

function getHttpProtocolFailure(
  parsedUrl: URL,
  hostname: string,
  isProduction: boolean,
  isLocalHost: boolean,
): RemoteUrlValidationResult | undefined {
  if (isProduction && parsedUrl.protocol !== "https:") {
    return {
      valid: false,
      failureCode: "PRODUCTION_HTTPS_REQUIRED",
      hostname,
      details: "Production requires HTTPS. The target host must be reachable over TLS.",
    };
  }

  if (!isProduction && parsedUrl.protocol === "http:" && !isLocalHost) {
    return {
      valid: false,
      failureCode: "REMOTE_HTTP_FORBIDDEN",
      hostname,
      details: "HTTP is only allowed for localhost in development. Use HTTPS for remote hosts.",
    };
  }

  return undefined;
}

export interface ValidateRemoteUrlOptions {
  /** Always enforce the private/link-local/loopback blocklist, ignoring `ALLOW_PRIVATE_NETWORK`.
   *  Use when a caller's policy must remain production-strict during development. */
  strict?: boolean;
  /** Permit private targets (plain HTTP too when every resolved address is private); cloud metadata stays blocked. */
  allowPrivateNetwork?: boolean;
}

export async function validateRemoteUrl(
  url: string,
  options?: ValidateRemoteUrlOptions,
): Promise<RemoteUrlValidationResult> {
  const isProduction = isProductionRuntime();
  const strict = options?.strict === true;
  const privateNetworkAllowed = !strict && (options?.allowPrivateNetwork === true || isEndpointPrivateNetworkAllowed());
  const enforceBlocklist = !privateNetworkAllowed;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      valid: false,
      failureCode: "INVALID_FORMAT",
      details: "Invalid URL format.",
    };
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return {
      valid: false,
      failureCode: "INVALID_PROTOCOL",
      hostname: normalizeHostname(parsedUrl.hostname),
      details: "URL must use HTTP or HTTPS protocol.",
    };
  }

  const hostname = normalizeHostname(parsedUrl.hostname);
  const isLocalHost = isExplicitLocalHost(hostname);
  // Most LAN services only speak HTTP, so under the opt-in the HTTP decision waits for DNS.
  // Only an explicit caller opt-in widens HTTP: media downloads also reach this gate, and Discord's proxy
  // fallback hands them plain-HTTP origins any member can post.
  const httpNeedsPrivateTarget = !strict && options?.allowPrivateNetwork === true && parsedUrl.protocol === "http:";
  const httpFailure = getHttpProtocolFailure(parsedUrl, hostname, isProduction, isLocalHost);

  if (httpFailure && !httpNeedsPrivateTarget) {
    return httpFailure;
  }

  if (enforceBlocklist && isLocalHost) {
    return {
      valid: false,
      failureCode: "PRODUCTION_LOCALHOST_FORBIDDEN",
      hostname,
      details: `Localhost is not allowed for this endpoint.${getPrivateNetworkRemedy(strict)}`,
    };
  }

  let resolvedAddresses: ResolvedRemoteAddress[];
  try {
    resolvedAddresses = await resolveHostnameAddresses(hostname);
  } catch (error) {
    return {
      valid: false,
      failureCode: "DNS_RESOLUTION_FAILED",
      hostname,
      details:
        `Failed to resolve hostname '${hostname}': ` + `${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (resolvedAddresses.length === 0) {
    return {
      valid: false,
      failureCode: "DNS_RESOLUTION_FAILED",
      hostname,
      details: `Failed to resolve hostname '${hostname}': no IP addresses found.`,
    };
  }

  // Always-on floor: cloud-metadata / link-local addresses are never valid
  // targets, even when the general blocklist is relaxed (development, or a
  // production private-network opt-in). They are the primary SSRF credential-
  // theft target, so this check runs independently of `enforceBlocklist`.
  const metadataAddress = resolvedAddresses.find((entry) => isCloudMetadataAddress(entry.address));
  if (metadataAddress) {
    return {
      valid: false,
      failureCode: "PRODUCTION_BLOCKED_ADDRESS",
      hostname,
      blockedAddress: metadataAddress.address,
      resolvedAddresses: resolvedAddresses.map((entry) => entry.address),
      details:
        `Resolved address '${metadataAddress.address}' for '${hostname}' is a cloud instance-metadata ` +
        "or link-local endpoint, which is always blocked and cannot be enabled by any opt-in.",
    };
  }

  if (httpFailure && httpNeedsPrivateTarget && resolvedAddresses.some((entry) => !entry.blockedInProduction)) {
    return httpFailure;
  }

  if (enforceBlocklist) {
    const blockedAddress = resolvedAddresses.find((entry) => entry.blockedInProduction);
    if (blockedAddress) {
      return {
        valid: false,
        failureCode: "PRODUCTION_BLOCKED_ADDRESS",
        hostname,
        blockedAddress: blockedAddress.address,
        resolvedAddresses: resolvedAddresses.map((entry) => entry.address),
        details: buildBlockedAddressDetails(hostname, blockedAddress, resolvedAddresses, strict),
      };
    }
  }

  return {
    valid: true,
    hostname,
    resolvedAddresses: resolvedAddresses.map((entry) => entry.address),
  };
}
