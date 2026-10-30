import { discoverOAuthServerInfo } from "@modelcontextprotocol/sdk/client/auth.js";
import type { AuthorizationServerMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { checkResourceAllowed, resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpAuthorizationChallenge } from "@/types/tool/mcpTypes";
import { fetchOAuthText, type OAuthFetch } from "@/utils/oauth/oauthFetch";

export interface McpAuthorizationServer {
  issuer: string;
  metadata: AuthorizationServerMetadata;
  tokenEndpoint: string;
  /** Sent verbatim: the SDK's parsed URL would append a slash that exact-match servers reject. */
  resource: string;
  scope: string | undefined;
  issParameterSupported: boolean;
  clientIdMetadataDocumentSupported: boolean;
}

export class McpOAuthDiscoveryError extends Error {}

/**
 * Discovery and registration reach authorization-server origins, which the MCP transport fetch
 * refuses by design, so they get their own SSRF-gated, bounded fetch instead of a widened one.
 */
export function createMcpOAuthDiscoveryFetch(fetchImpl?: OAuthFetch): FetchLike {
  return async (input, init) => {
    const url = new URL(input.toString());
    const { response, body } = await fetchOAuthText(url.toString(), init ?? {}, {
      allowedOrigins: [url.origin],
      fetchImpl,
    });
    // The SDK follows a same-origin `Location` on its own, so a redirect comes back without one.
    if (response.status >= 300 && response.status < 400) return new Response(null, { status: response.status });
    const contentType = response.headers.get("content-type");
    return new Response(body || null, {
      status: response.status,
      statusText: response.statusText,
      headers: contentType ? { "Content-Type": contentType } : undefined,
    });
  };
}

function isHttpsUrl(value: string): boolean {
  return URL.parse(value)?.protocol === "https:";
}

/** Challenged scope first, then the resource's advertised scopes, otherwise the server default. */
export function selectMcpScope(
  challengedScope: string | undefined,
  resourceScopes: readonly string[] | undefined,
  serverScopes: readonly string[] | undefined,
): string | undefined {
  const scopes = (challengedScope?.trim() || resourceScopes?.join(" ") || "").split(" ").filter(Boolean);
  // Requesting offline_access alone would replace the server's default scope, so it only extends a list.
  if (scopes.length > 0 && serverScopes?.includes("offline_access")) scopes.push("offline_access");
  return scopes.length > 0 ? [...new Set(scopes)].join(" ") : undefined;
}

/**
 * Finds the authorization server for an MCP server and checks what the SDK leaves unchecked: the
 * metadata issuer, the protected resource audience, and HTTPS endpoints.
 *
 * @throws McpOAuthDiscoveryError When the server cannot be signed in to safely
 */
export async function discoverMcpAuthorizationServer(
  serverUrl: string,
  challenge: McpAuthorizationChallenge,
  fetchFn: FetchLike = createMcpOAuthDiscoveryFetch(),
): Promise<McpAuthorizationServer> {
  if (!isHttpsUrl(serverUrl)) throw new McpOAuthDiscoveryError("MCP sign-in requires an HTTPS server URL.");
  const info = await discoverOAuthServerInfo(serverUrl, {
    resourceMetadataUrl: challenge.resourceMetadataUrl ? new URL(challenge.resourceMetadataUrl) : undefined,
    fetchFn,
  });
  const resourceMetadata = info.resourceMetadata;
  const metadata = info.authorizationServerMetadata;
  // Without protected resource metadata the SDK guesses the server origin as the issuer; the spec makes the metadata mandatory.
  if (!resourceMetadata?.authorization_servers?.length || !metadata) {
    throw new McpOAuthDiscoveryError("The MCP server does not publish usable authorization metadata.");
  }
  if (metadata.issuer !== info.authorizationServerUrl) {
    throw new McpOAuthDiscoveryError("The authorization server metadata names a different issuer.");
  }
  if (
    !checkResourceAllowed({
      requestedResource: resourceUrlFromServerUrl(serverUrl),
      configuredResource: resourceMetadata.resource,
    })
  ) {
    throw new McpOAuthDiscoveryError("The protected resource does not match the MCP server URL.");
  }
  const endpoints = [metadata.issuer, metadata.authorization_endpoint, metadata.token_endpoint];
  if (metadata.registration_endpoint) endpoints.push(metadata.registration_endpoint);
  if (!endpoints.every(isHttpsUrl)) {
    throw new McpOAuthDiscoveryError("The authorization server uses a non-HTTPS endpoint.");
  }
  if (
    !metadata.response_types_supported.includes("code") ||
    !metadata.code_challenge_methods_supported?.includes("S256")
  ) {
    throw new McpOAuthDiscoveryError(
      "The authorization server does not support the authorization code flow with PKCE.",
    );
  }
  return {
    issuer: metadata.issuer,
    metadata,
    tokenEndpoint: metadata.token_endpoint,
    resource: resourceMetadata.resource,
    scope: selectMcpScope(challenge.scope, resourceMetadata.scopes_supported, metadata.scopes_supported),
    issParameterSupported:
      (metadata as Record<string, unknown>).authorization_response_iss_parameter_supported === true,
    clientIdMetadataDocumentSupported: metadata.client_id_metadata_document_supported === true,
  };
}
