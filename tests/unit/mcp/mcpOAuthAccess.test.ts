import { describe, expect, it, mock, spyOn } from "bun:test";
import type { GuildMcpServerRow } from "@/types/db/schema";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { createGuildMcpFetch, type GuildMcpFetchAuthorization } from "@/utils/mcp/guildMcpFetch";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import type { OAuthFetch } from "@/utils/oauth/oauthFetch";
import { OAuthRefreshCoordinator, type OAuthTokenStore } from "@/utils/oauth/refreshCoordinator";
import type { OAuthTokenError } from "@/utils/oauth/tokenEndpoint";
import * as remotePolicy from "@/utils/security/remoteUrlSecurity";
import { stubGlobalFetch } from "../../helpers/fetchStub";

const ENDPOINT = "https://auth.example/token";

function memoryStore(connection: {
  accessToken: string | null;
  expiresAt: number | null;
  refreshToken: string | null;
}) {
  const persisted: Array<{ refreshToken: string; expiresAt: Date | null }> = [];
  const failures: OAuthTokenError[] = [];
  const store: OAuthTokenStore = {
    withLock: (operation) =>
      operation({
        load: async () => ({
          ...connection,
          blocked: false,
          retryAt: null,
          authentication: { method: "none", clientId: "client-one" },
        }),
        persist: async (_token, refreshToken, expiresAt) => {
          persisted.push({ refreshToken, expiresAt });
        },
        fail: async (error) => {
          failures.push(error);
        },
      }),
  };
  return { store, persisted, failures };
}

function refreshOptions(store: OAuthTokenStore, fetchImpl: OAuthFetch) {
  return {
    key: "grant",
    store,
    endpoint: ENDPOINT,
    allowedOrigins: [new URL(ENDPOINT).origin],
    optionalExpiresIn: true,
    fetchImpl,
    onFailure: () => {},
  };
}

describe("MCP grant refresh through the shared coordinator", () => {
  it("uses a token without a lifetime until it is rejected, then blocks a grant that cannot refresh", async () => {
    const fetchImpl = mock<OAuthFetch>(async () => Response.json({}));
    const lifelong = memoryStore({ accessToken: "access-one", expiresAt: null, refreshToken: null });
    const coordinator = new OAuthRefreshCoordinator();
    expect(await coordinator.getAccessToken(refreshOptions(lifelong.store, fetchImpl))).toBe("access-one");

    const expired = memoryStore({ accessToken: "access-one", expiresAt: Date.now() - 1, refreshToken: null });
    coordinator.invalidate("grant", "access-one");
    expect(await coordinator.getAccessToken(refreshOptions(expired.store, fetchImpl))).toBeNull();
    expect(expired.failures.map((failure) => failure.disposition)).toEqual(["blocked"]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("persists a rotated refresh token and a missing lifetime before returning the new access token", async () => {
    const fetchImpl = mock<OAuthFetch>(async () =>
      Response.json({ access_token: "access-two", refresh_token: "refresh-two", token_type: "bearer" }),
    );
    const renewable = memoryStore({
      accessToken: "access-one",
      expiresAt: Date.now() - 1,
      refreshToken: "refresh-one",
    });
    const coordinator = new OAuthRefreshCoordinator();
    expect(await coordinator.getAccessToken(refreshOptions(renewable.store, fetchImpl))).toBe("access-two");
    expect(renewable.persisted).toEqual([{ refreshToken: "refresh-two", expiresAt: null }]);
    expect(new URLSearchParams(String(fetchImpl.mock.calls[0]?.[1]?.body)).get("refresh_token")).toBe("refresh-one");
  });
});

describe("signed-in MCP requests", () => {
  function authorization(replacement: string | null = "access-two") {
    return {
      token: mock(async () => "access-one"),
      replace: mock(async (_rejected: string) => replacement),
      reauthorize: mock(async (_scope?: string) => {}),
    } satisfies GuildMcpFetchAuthorization;
  }

  async function withMcpOrigin(run: (responses: Response[], sent: Headers[]) => Promise<void>): Promise<void> {
    const validation = spyOn(remotePolicy, "validateRemoteUrl").mockResolvedValue({
      valid: true,
      hostname: "mcp.example.org",
      resolvedAddresses: ["203.0.113.10"],
    });
    const responses: Response[] = [];
    const sent: Headers[] = [];
    const fetchSpy = stubGlobalFetch((input, init) => {
      expect(String(input)).toStartWith("https://203.0.113.10/");
      sent.push(new Headers(init?.headers));
      return responses.shift() ?? new Response("{}");
    });
    try {
      await run(responses, sent);
    } finally {
      fetchSpy.mockRestore();
      validation.mockRestore();
    }
  }

  it("refreshes once after a 401 and asks for sign-in only when the replacement is rejected too", async () => {
    await withMcpOrigin(async (responses, sent) => {
      const recovering = authorization();
      responses.push(new Response(null, { status: 401 }), new Response("{}"));
      const recovered = await createGuildMcpFetch(
        "https://mcp.example.org/mcp",
        undefined,
        recovering,
      )("https://mcp.example.org/mcp", { method: "POST", body: "{}" });
      expect(recovered.status).toBe(200);
      expect(sent.map((headers) => headers.get("authorization"))).toEqual(["Bearer access-one", "Bearer access-two"]);
      expect(recovering.replace.mock.calls).toEqual([["access-one"]]);
      expect(recovering.reauthorize).not.toHaveBeenCalled();

      const revoked = authorization();
      responses.push(new Response(null, { status: 401 }), new Response(null, { status: 401 }));
      const onUnauthorized = mock((_response: Response) => {});
      await createGuildMcpFetch("https://mcp.example.org/mcp", onUnauthorized, revoked)("https://mcp.example.org/mcp");
      expect(revoked.reauthorize.mock.calls).toEqual([[]]);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);

      const unrenewable = authorization(null);
      sent.length = 0;
      responses.push(new Response(null, { status: 401 }));
      await createGuildMcpFetch("https://mcp.example.org/mcp", undefined, unrenewable)("https://mcp.example.org/mcp");
      expect(sent).toHaveLength(1);
      expect(unrenewable.reauthorize).not.toHaveBeenCalled();
    });
  });

  it("records a step-up challenge's scope and leaves other 403s alone", async () => {
    await withMcpOrigin(async (responses) => {
      const stepUp = authorization();
      responses.push(
        new Response(null, {
          status: 403,
          headers: { "WWW-Authenticate": 'Bearer error="insufficient_scope", scope="read admin"' },
        }),
        new Response(null, { status: 403 }),
      );
      const guarded = createGuildMcpFetch("https://mcp.example.org/mcp", undefined, stepUp);
      await guarded("https://mcp.example.org/mcp");
      await guarded("https://mcp.example.org/mcp");
      expect(stepUp.reauthorize.mock.calls).toEqual([["read admin"]]);
    });
  });

  it("never sends a signed-in token off the registered origin", async () => {
    const signedIn = authorization();
    const fetchSpy = stubGlobalFetch(() => new Response("{}"));
    try {
      await expect(
        createGuildMcpFetch("https://mcp.example.org/mcp", undefined, signedIn)("https://auth.example/token"),
      ).rejects.toThrow();
      expect(signedIn.token).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("signed-in MCP registrations awaiting Reconnect", () => {
  it("are skipped without dialing or extending the auto-disable streak", async () => {
    const row: GuildMcpServerRow = {
      guild_mcp_id: 961,
      server_id: 961,
      name: "paused-sign-in",
      url: "https://mcp.example.org/mcp",
      auth_token: null,
      key_version: 1,
      is_enabled: true,
      server_type: null,
      oauth_status: "needs_reauthorization",
    };
    const record = spyOn(toolRepository, "recordMcpConnectFailure");
    const validation = spyOn(remotePolicy, "validateRemoteUrl");
    try {
      expect(await getGuildMcpManager().getRegisteredTool(row)).toBeNull();
      await getGuildMcpManager().eagerConnectAll([row]);
      expect(validation).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    } finally {
      validation.mockRestore();
      record.mockRestore();
    }
  });
});
