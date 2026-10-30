import { describe, expect, it, mock } from "bun:test";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  buildMcpOAuthClientMetadata,
  type McpOAuthClientDependencies,
  resolveMcpOAuthClientId,
} from "@/utils/mcp/oauth/clientIdentity";
import {
  createMcpOAuthDiscoveryFetch,
  discoverMcpAuthorizationServer,
  type McpAuthorizationServer,
  McpOAuthDiscoveryError,
  selectMcpScope,
} from "@/utils/mcp/oauth/discovery";
import type { OAuthFetch } from "@/utils/oauth/oauthFetch";

const SERVER_URL = "https://mcp.example/mcp";
const PRM_URL = "https://mcp.example/.well-known/oauth-protected-resource/mcp";

function resourceMetadata(overrides: Record<string, unknown> = {}) {
  return {
    resource: SERVER_URL,
    authorization_servers: ["https://auth.example"],
    scopes_supported: ["read", "write"],
    ...overrides,
  };
}

function serverMetadata(overrides: Record<string, unknown> = {}) {
  return {
    issuer: "https://auth.example",
    authorization_endpoint: "https://auth.example/authorize",
    token_endpoint: "https://auth.example/token",
    registration_endpoint: "https://auth.example/register",
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    ...overrides,
  };
}

/** Serves JSON documents by exact URL and answers 404 elsewhere, recording each requested URL. */
function documents(routes: Record<string, unknown>): { fetchFn: FetchLike; requested: string[] } {
  const requested: string[] = [];
  const fetchFn: FetchLike = async (input) => {
    const url = input.toString();
    requested.push(url);
    return url in routes ? Response.json(routes[url]) : new Response(null, { status: 404 });
  };
  return { fetchFn, requested };
}

function standardRoutes(
  prm: Record<string, unknown> = resourceMetadata(),
  metadata: Record<string, unknown> = serverMetadata(),
) {
  return { [PRM_URL]: prm, "https://auth.example/.well-known/oauth-authorization-server": metadata };
}

describe("MCP authorization discovery", () => {
  it("binds the audience, issuer, and scopes from the challenge or the well-known metadata", async () => {
    const challenged = documents({
      "https://mcp.example/custom-prm": resourceMetadata(),
      "https://auth.example/.well-known/oauth-authorization-server": serverMetadata(),
    });
    const server = await discoverMcpAuthorizationServer(
      SERVER_URL,
      { resourceMetadataUrl: "https://mcp.example/custom-prm", scope: "issues:read" },
      challenged.fetchFn,
    );
    expect(challenged.requested[0]).toBe("https://mcp.example/custom-prm");
    expect(server).toMatchObject({
      issuer: "https://auth.example",
      tokenEndpoint: "https://auth.example/token",
      resource: SERVER_URL,
      scope: "issues:read",
      issParameterSupported: true,
      clientIdMetadataDocumentSupported: true,
    });

    const wellKnown = documents(standardRoutes());
    expect((await discoverMcpAuthorizationServer(SERVER_URL, {}, wellKnown.fetchFn)).scope).toBe("read write");
    expect(wellKnown.requested[0]).toBe(PRM_URL);
  });

  it("falls back to OpenID discovery when the server has no RFC 8414 document", async () => {
    const { fetchFn } = documents({
      [PRM_URL]: resourceMetadata(),
      "https://auth.example/.well-known/openid-configuration": {
        ...serverMetadata(),
        jwks_uri: "https://auth.example/jwks",
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      },
    });
    expect((await discoverMcpAuthorizationServer(SERVER_URL, {}, fetchFn)).issuer).toBe("https://auth.example");
  });

  it("refuses servers it cannot sign in to safely", async () => {
    const refusals: Array<[string, Record<string, unknown>, string?]> = [
      [
        "missing resource metadata",
        { "https://auth.example/.well-known/oauth-authorization-server": serverMetadata() },
      ],
      ["no authorization servers", standardRoutes(resourceMetadata({ authorization_servers: [] }))],
      ["issuer mismatch", standardRoutes(resourceMetadata(), serverMetadata({ issuer: "https://other.example" }))],
      ["foreign audience", standardRoutes(resourceMetadata({ resource: "https://other.example/mcp" }))],
      [
        "plain HTTP token endpoint",
        standardRoutes(resourceMetadata(), serverMetadata({ token_endpoint: "http://auth.example/token" })),
      ],
      ["no S256", standardRoutes(resourceMetadata(), serverMetadata({ code_challenge_methods_supported: ["plain"] }))],
      [
        "no PKCE methods listed",
        standardRoutes(resourceMetadata(), serverMetadata({ code_challenge_methods_supported: undefined })),
      ],
      ["plain HTTP MCP server", standardRoutes(), "http://mcp.example/mcp"],
    ];
    for (const [label, routes, serverUrl] of refusals) {
      const { fetchFn } = documents(routes);
      const attempt = discoverMcpAuthorizationServer(serverUrl ?? SERVER_URL, {}, fetchFn);
      await expect(attempt, label).rejects.toBeInstanceOf(McpOAuthDiscoveryError);
    }
  });

  it("selects the challenged scope, then the resource scopes, and only extends a list with offline_access", () => {
    expect(selectMcpScope("a b", ["c"], ["offline_access"])).toBe("a b offline_access");
    expect(selectMcpScope(undefined, ["c", "d"], undefined)).toBe("c d");
    expect(selectMcpScope(" ", undefined, ["offline_access"])).toBeUndefined();
    expect(selectMcpScope("offline_access a", undefined, ["offline_access"])).toBe("offline_access a");
  });
});

describe("MCP discovery fetch", () => {
  it("refuses plain HTTP, strips redirects so they are not followed, and caps the body", async () => {
    const fetchImpl = mock<OAuthFetch>(async (input, init) => {
      expect(init?.redirect).toBe("manual");
      const url = input.toString();
      if (url.endsWith("/redirect")) {
        return new Response(null, { status: 302, headers: { Location: "https://auth.example/elsewhere" } });
      }
      if (url.endsWith("/large")) return new Response("x".repeat(129 * 1024));
      return Response.json({ ok: true });
    });
    const discoveryFetch = createMcpOAuthDiscoveryFetch(fetchImpl);

    await expect(discoveryFetch("http://auth.example/metadata")).rejects.toThrow();
    const redirect = await discoveryFetch("https://auth.example/redirect");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBeNull();
    await expect(discoveryFetch("https://auth.example/large")).rejects.toThrow();
    expect(await (await discoveryFetch("https://auth.example/metadata")).json()).toEqual({ ok: true });
  });
});

describe("MCP OAuth client identity", () => {
  const PUBLIC_BASE = "https://bot.example";
  const LOOPBACK_BASE = "http://127.0.0.1:8080";

  function server(overrides: Partial<McpAuthorizationServer> = {}): McpAuthorizationServer {
    return {
      issuer: "https://auth.example",
      metadata: serverMetadata() as unknown as McpAuthorizationServer["metadata"],
      tokenEndpoint: "https://auth.example/token",
      resource: SERVER_URL,
      scope: undefined,
      issParameterSupported: true,
      clientIdMetadataDocumentSupported: true,
      ...overrides,
    };
  }

  function registry(registration: Record<string, unknown> = { client_id: "registered-client" }) {
    const stored = new Map<string, string>();
    const bodies: Record<string, unknown>[] = [];
    const dependencies: McpOAuthClientDependencies = {
      findRegisteredClient: async (issuer, redirectUri) => stored.get(`${issuer} ${redirectUri}`) ?? null,
      saveRegisteredClient: async (issuer, redirectUri, clientId) => {
        stored.set(`${issuer} ${redirectUri}`, clientId);
        return clientId;
      },
      fetchFn: async (input, init) => {
        expect(input.toString()).toBe("https://auth.example/register");
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ redirect_uris: bodies.at(-1)?.redirect_uris, ...registration }, { status: 201 });
      },
    };
    return { dependencies, bodies };
  }

  it("uses the metadata document on a public origin and registers a public client otherwise", async () => {
    const { dependencies, bodies } = registry();
    expect(await resolveMcpOAuthClientId(server(), PUBLIC_BASE, dependencies)).toBe(
      buildMcpOAuthClientMetadata(PUBLIC_BASE).client_id,
    );
    expect(bodies).toHaveLength(0);

    expect(await resolveMcpOAuthClientId(server(), LOOPBACK_BASE, dependencies)).toBe("registered-client");
    expect(bodies[0]).toMatchObject({
      redirect_uris: [`${LOOPBACK_BASE}/oauth/callback`],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
    });
    expect(bodies[0]).not.toHaveProperty("client_id");

    expect(
      await resolveMcpOAuthClientId(server({ clientIdMetadataDocumentSupported: false }), PUBLIC_BASE, dependencies),
    ).toBe("registered-client");
    expect(bodies).toHaveLength(2);
  });

  it("reuses one registration per issuer and redirect URI, and registers again when the port changes", async () => {
    const { dependencies, bodies } = registry();
    await resolveMcpOAuthClientId(server(), LOOPBACK_BASE, dependencies);
    await resolveMcpOAuthClientId(server(), LOOPBACK_BASE, dependencies);
    expect(bodies).toHaveLength(1);
    await resolveMcpOAuthClientId(server(), "http://127.0.0.1:9090", dependencies);
    expect(bodies).toHaveLength(2);
  });

  it("refuses a registration that comes back as a confidential client", async () => {
    for (const registration of [
      { client_id: "confidential", client_secret: "issued-secret" },
      { client_id: "confidential", token_endpoint_auth_method: "client_secret_basic" },
    ]) {
      const { dependencies } = registry(registration);
      await expect(resolveMcpOAuthClientId(server(), LOOPBACK_BASE, dependencies)).rejects.toBeInstanceOf(
        McpOAuthDiscoveryError,
      );
    }
  });
});
