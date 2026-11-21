import { registerClient } from "@modelcontextprotocol/sdk/client/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { guildMcpOAuthRepository } from "@/utils/db/repositories/GuildMcpOAuthRepository";
import {
  createMcpOAuthDiscoveryFetch,
  McpOAuthDiscoveryError,
  type McpAuthorizationServer,
} from "@/utils/mcp/oauth/discovery";
import { OAUTH_CALLBACK_PATH } from "@/utils/oauth/settings";

export const OAUTH_CLIENT_METADATA_PATH = "/oauth/client.json";

/** `getOAuthPublicBaseUrl` admits plain HTTP only for a loopback origin. */
export function isLoopbackPublicBaseUrl(publicBaseUrl: string): boolean {
  return new URL(publicBaseUrl).protocol === "http:";
}

/** A public client: there is no secret to store or rotate, so PKCE is the only proof of possession. */
export function buildMcpOAuthClientMetadata(publicBaseUrl: string) {
  return {
    client_id: `${publicBaseUrl}${OAUTH_CLIENT_METADATA_PATH}`,
    client_name: "TomoriBot",
    redirect_uris: [`${publicBaseUrl}${OAUTH_CALLBACK_PATH}`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export interface McpOAuthClientDependencies {
  findRegisteredClient(issuer: string, redirectUri: string): Promise<string | null>;
  saveRegisteredClient(issuer: string, redirectUri: string, clientId: string): Promise<string>;
  fetchFn: FetchLike;
}

const defaultDependencies: McpOAuthClientDependencies = {
  findRegisteredClient: (issuer, redirectUri) => guildMcpOAuthRepository.findRegisteredClient(issuer, redirectUri),
  saveRegisteredClient: (issuer, redirectUri, clientId) =>
    guildMcpOAuthRepository.saveRegisteredClient(issuer, redirectUri, clientId),
  fetchFn: createMcpOAuthDiscoveryFetch(),
};

/**
 * Uses the client metadata document where the server accepts one, and otherwise one Dynamic Client
 * Registration per issuer and redirect URI.
 *
 * @throws McpOAuthDiscoveryError When registration returns a confidential client
 */
export async function resolveMcpOAuthClientId(
  server: McpAuthorizationServer,
  publicBaseUrl: string,
  dependencies: McpOAuthClientDependencies = defaultDependencies,
): Promise<string> {
  const { client_id: metadataDocumentUrl, ...clientMetadata } = buildMcpOAuthClientMetadata(publicBaseUrl);
  // The authorization server fetches the metadata document itself, which a loopback origin cannot serve.
  if (server.clientIdMetadataDocumentSupported && !isLoopbackPublicBaseUrl(publicBaseUrl)) return metadataDocumentUrl;
  const redirectUri = clientMetadata.redirect_uris[0];
  const stored = await dependencies.findRegisteredClient(server.issuer, redirectUri);
  if (stored) return stored;
  const registered = await registerClient(server.issuer, {
    metadata: server.metadata,
    clientMetadata,
    fetchFn: dependencies.fetchFn,
  });
  if (registered.client_secret || (registered.token_endpoint_auth_method ?? "none") !== "none") {
    throw new McpOAuthDiscoveryError("The authorization server registered a confidential client.");
  }
  return dependencies.saveRegisteredClient(server.issuer, redirectUri, registered.client_id);
}
