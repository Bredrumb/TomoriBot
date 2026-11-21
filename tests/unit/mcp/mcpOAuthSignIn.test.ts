import { once } from "node:events";
import { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { startHealthServer } from "@/init/healthServer";
import type { GuildMcpServerRow } from "@/types/db/schema";
import type { GuildMcpOAuthGrant } from "@/utils/db/repositories/GuildMcpOAuthRepository";
import type { CompleteMcpSignInResult, McpSignInDraft } from "@/utils/mcp/mcpConfigOperations";
import type { McpAuthorizationServer } from "@/utils/mcp/oauth/discovery";
import { initializeMcpOAuthRoutes } from "@/utils/mcp/oauth/routes";
import {
  configureMcpSignIn,
  deriveMcpStateSigner,
  findMcpAuthorizationUrl,
  handleMcpOAuthCallback,
  handleMcpOAuthConfirm,
  isMcpSignInAvailable,
  type McpSignInOutcome,
  resetMcpSignInForTests,
  startMcpSignIn,
} from "@/utils/mcp/oauth/signIn";
import { eventLoopMonitor } from "@/utils/misc/eventLoopMonitor";
import { log } from "@/utils/misc/logger";
import { clearOAuthCallbackFlowsForTests, initializeOAuthCallbackRoute } from "@/utils/oauth/callbackRoute";
import type { OAuthFetch } from "@/utils/oauth/oauthFetch";
import { createSignedOAuthState, type OAuthStateNonceRepository, validateSignedOAuthState } from "@/utils/oauth/state";
import { keyManager } from "@/utils/security/keyManager";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";
import { stubLogMembers } from "../../helpers/mockSurface";

beforeAll(initializeLocalizer);
afterEach(resetMcpSignInForTests);
stubLogMembers({ success: () => undefined, error: () => undefined });
const warn = spyOn(log, "warn").mockImplementation(() => undefined);
afterAll(() => warn.mockRestore());

const PUBLIC_BASE = "https://bot.example";
const SIGNER = "synthetic-mcp-signer";
const SERVER_URL = "https://mcp.example/mcp";
const ACCESS_TOKEN = "synthetic-access-canary";
const CODE = "synthetic-code-canary";

function authorizationServer(overrides: Partial<McpAuthorizationServer> = {}): McpAuthorizationServer {
  return {
    issuer: "https://auth.example",
    metadata: {
      issuer: "https://auth.example",
      authorization_endpoint: "https://auth.example/authorize",
      token_endpoint: "https://auth.example/token",
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
    },
    tokenEndpoint: "https://auth.example/token",
    resource: SERVER_URL,
    scope: "read write",
    issParameterSupported: true,
    clientIdMetadataDocumentSupported: true,
    ...overrides,
  };
}

function memoryStateRepository(): OAuthStateNonceRepository {
  const states = new Map<string, { consumed: boolean }>();
  return {
    recordStateNonce: async ({ nonceHash }) => states.set(nonceHash, { consumed: false }),
    consumeStateNonce: async ({ nonceHash }) => {
      const state = states.get(nonceHash);
      if (!state || state.consumed) return null;
      state.consumed = true;
      return state;
    },
  };
}

function successResult(draft: McpSignInDraft): CompleteMcpSignInResult {
  const row: GuildMcpServerRow = {
    guild_mcp_id: 7,
    server_id: draft.serverId,
    name: draft.name,
    url: draft.url,
    auth_token: null,
    key_version: 1,
    is_enabled: true,
    server_type: null,
  };
  return { status: "success", row, test: { success: true, toolCount: 1, functionNames: ["search"] } };
}

function harness(options: { server?: McpAuthorizationServer; token?: Record<string, unknown> } = {}) {
  let clock = Date.parse("2026-10-30T00:00:00Z");
  const tokenFetch = mock<OAuthFetch>(async () =>
    Response.json(options.token ?? { access_token: ACCESS_TOKEN, token_type: "Bearer" }),
  );
  const complete = mock(async (draft: McpSignInDraft, _grant: GuildMcpOAuthGrant) => successResult(draft));
  const report = mock(async (_outcome: McpSignInOutcome) => {});
  configureMcpSignIn({
    publicBaseUrl: PUBLIC_BASE,
    signerSecret: SIGNER,
    dependencies: {
      complete,
      discover: async () => options.server ?? authorizationServer(),
      resolveClientId: async () => "client-one",
      stateRepository: memoryStateRepository(),
      tokenFetch,
      now: () => new Date(clock),
    },
  });
  return {
    tokenFetch,
    complete,
    report,
    advance: (ms: number) => {
      clock += ms;
    },
    start: async (guildName = "Mirri's Garden") => {
      const started = await startMcpSignIn({
        draft: {
          serverId: 9,
          serverDiscId: "100000000000000001",
          guildName,
          name: "issues",
          url: SERVER_URL,
          serverType: "general",
        },
        challenge: {},
        locale: "en-US",
        report,
      });
      if (started.status !== "started") throw new Error("Sign-in did not start");
      const signInUrl = new URL(started.signInUrl);
      const target = findMcpAuthorizationUrl(signInUrl.searchParams.get("id") ?? "");
      if (!target) throw new Error("Sign-in link does not resolve");
      const authorizationUrl = new URL(target);
      return { signInUrl, authorizationUrl, state: authorizationUrl.searchParams.get("state") ?? "" };
    },
  };
}

function callback(state: string, params: Record<string, string> = { code: CODE, iss: "https://auth.example" }) {
  const url = new URL(`${PUBLIC_BASE}/oauth/callback`);
  url.searchParams.set("state", state);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return handleMcpOAuthCallback(url);
}

function confirmationToken(body: string): string {
  return /name="confirmation" value="([^"]+)"/.exec(body)?.[1] ?? "";
}

function confirm(state: string, confirmation: string, action: "connect" | "cancel" = "connect") {
  return handleMcpOAuthConfirm(new URLSearchParams({ state, confirmation, action }));
}

function page(key: string, variables: Record<string, string> = {}): string {
  return localizedCopy("en-US", `commands.mcps.oauth_page.${key}`, variables);
}

describe("MCP sign-in authorization request", () => {
  it("is unavailable until its routes are configured", async () => {
    expect(isMcpSignInAvailable()).toBe(false);
    const report = mock(async () => {});
    const started = await startMcpSignIn({
      draft: { serverId: 9, serverDiscId: "1", guildName: "g", name: "n", url: SERVER_URL, serverType: "general" },
      challenge: {},
      locale: "en-US",
      report,
    });
    expect(started.status).toBe("unavailable");
  });

  it("sends PKCE S256, the resource, the callback, and a ten-minute signed mcp state", async () => {
    const { start } = harness();
    const { authorizationUrl, state } = await start();
    const params = authorizationUrl.searchParams;
    expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe("https://auth.example/authorize");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("client-one");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")?.length).toBe(43);
    expect(params.get("redirect_uri")).toBe(`${PUBLIC_BASE}/oauth/callback`);
    expect(params.get("resource")).toBe(SERVER_URL);
    expect(params.get("scope")).toBe("read write");
    const validation = validateSignedOAuthState(state, SIGNER, new Date("2026-10-30T00:09:59Z"), "mcp");
    expect(validation.valid && validation.payload).toMatchObject({ subject: "100000000000000001", locale: "en-US" });
    expect(validateSignedOAuthState(state, SIGNER, new Date("2026-10-30T00:10:00Z"), "mcp").valid).toBe(false);
  });
});

describe("MCP sign-in link", () => {
  it("fits a Discord button URL and resolves only while the sign-in waits for its callback", async () => {
    const first = harness();
    const { signInUrl, state } = await first.start();
    expect(`${signInUrl.origin}${signInUrl.pathname}`).toBe(`${PUBLIC_BASE}/oauth/mcp/start`);
    expect(signInUrl.href.length).toBeLessThanOrEqual(512);
    const id = signInUrl.searchParams.get("id") ?? "";
    await callback(state);
    expect(findMcpAuthorizationUrl(id)).toBeNull();

    const second = harness();
    const expiring = await second.start();
    second.advance(10 * 60_000);
    expect(findMcpAuthorizationUrl(expiring.signInUrl.searchParams.get("id") ?? "")).toBeNull();
    expect(findMcpAuthorizationUrl("unknown")).toBeNull();
  });
});

describe("MCP sign-in confirmation", () => {
  it("holds the code until Connect, then exchanges it only at the recorded token endpoint", async () => {
    const { start, tokenFetch, complete, report } = harness();
    const { authorizationUrl, state } = await start();
    const held = await callback(state);
    expect(held.statusCode).toBe(200);
    expect(held.body).toContain(page("confirm_title"));
    expect(held.body).not.toContain(CODE);
    expect(tokenFetch).not.toHaveBeenCalled();

    const connected = await confirm(state, confirmationToken(held.body));
    expect(connected.statusCode).toBe(200);
    expect(connected.body).toContain(page("success_title"));
    expect(tokenFetch).toHaveBeenCalledTimes(1);
    const [endpoint, init] = tokenFetch.mock.calls[0] ?? [];
    expect(String(endpoint)).toBe("https://auth.example/token");
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: "authorization_code",
      code: CODE,
      redirect_uri: `${PUBLIC_BASE}/oauth/callback`,
      resource: SERVER_URL,
      client_id: "client-one",
    });
    expect(body.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);
    expect(body.get("code_verifier")).not.toBe(authorizationUrl.searchParams.get("code_challenge"));
    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      accessToken: ACCESS_TOKEN,
      refreshToken: null,
      expiresAt: null,
      requestedScopes: "read write",
      grantedScopes: null,
      resource: SERVER_URL,
      tokenEndpoint: "https://auth.example/token",
    });
    expect(report.mock.calls[0]?.[0]).toMatchObject({ status: "completed", result: { status: "success" } });
  });

  it("records a refresh token and lifetime when the server sends them", async () => {
    const { start, complete } = harness({
      token: { access_token: ACCESS_TOKEN, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 60 },
    });
    const { state } = await start();
    await confirm(state, confirmationToken((await callback(state)).body));
    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      refreshToken: "synthetic-refresh",
      expiresAt: new Date("2026-10-30T00:01:00Z"),
    });
  });

  it("exchanges nothing for Cancel, a replay, a forged token, a POST without a callback, a second callback, or expiry", async () => {
    const first = harness();
    const cancelled = await first.start();
    const cancelledPage = await callback(cancelled.state);
    expect((await confirm(cancelled.state, confirmationToken(cancelledPage.body), "cancel")).body).toContain(
      page("cancelled_title"),
    );
    expect(first.report.mock.calls[0]?.[0]).toEqual({ status: "cancelled" });
    expect((await confirm(cancelled.state, confirmationToken(cancelledPage.body))).body).toContain(
      page("expired_title"),
    );

    const replayed = await first.start();
    const replayedPage = await callback(replayed.state);
    expect((await callback(replayed.state)).body).toContain(page("expired_title"));
    expect((await confirm(replayed.state, "forged-confirmation")).body).toContain(page("expired_title"));
    expect((await confirm(replayed.state, confirmationToken(replayedPage.body))).statusCode).toBe(200);
    expect((await confirm(replayed.state, confirmationToken(replayedPage.body))).body).toContain(page("expired_title"));
    expect(first.tokenFetch).toHaveBeenCalledTimes(1);

    const second = harness();
    const unconfirmed = await second.start();
    expect((await confirm(unconfirmed.state, "no-callback-yet")).body).toContain(page("expired_title"));
    const expired = await second.start();
    second.advance(10 * 60_000);
    expect((await callback(expired.state)).body).toContain(page("expired_title"));
    expect(second.tokenFetch).not.toHaveBeenCalled();
    expect(second.complete).not.toHaveBeenCalled();
  });

  it("applies the recorded iss rule and never shows the server's error text", async () => {
    const strict = harness();
    const missingIssuer = await strict.start();
    expect((await callback(missingIssuer.state, { code: CODE })).body).toContain(page("failed_title"));
    const mismatched = await strict.start();
    const mismatchPage = await callback(mismatched.state, {
      iss: "https://attacker.example",
      error: "access_denied",
      error_description: "synthetic-provider-text",
    });
    expect(mismatchPage.body).toContain(page("failed_title"));
    expect(mismatchPage.body).not.toContain("synthetic-provider-text");
    const declined = await strict.start();
    const declinedPage = await callback(declined.state, {
      iss: "https://auth.example",
      error: "access_denied",
      error_description: "synthetic-provider-text",
    });
    expect(declinedPage.body).toContain(page("declined_title"));
    expect(declinedPage.body).not.toContain("synthetic-provider-text");
    expect(strict.report.mock.calls.map(([outcome]) => outcome.status)).toEqual(["failed", "failed", "declined"]);

    const lenient = harness({ server: authorizationServer({ issParameterSupported: false }) });
    const withoutIssuer = await lenient.start();
    expect((await callback(withoutIssuer.state, { code: CODE })).body).toContain(page("confirm_title"));
    const wrongIssuer = await lenient.start();
    expect((await callback(wrongIssuer.state, { code: CODE, iss: "https://attacker.example" })).body).toContain(
      page("failed_title"),
    );
    expect(strict.tokenFetch).not.toHaveBeenCalled();
    expect(lenient.tokenFetch).not.toHaveBeenCalled();
  });

  it("escapes the guild and host names it shows", async () => {
    const { start } = harness();
    const { state } = await start(`<img src=x onerror="alert('Juno')">&`);
    const body = (await callback(state)).body;
    expect(body).not.toContain("<img");
    expect(body).toContain("&lt;img src=x onerror=&quot;alert(&#39;Juno&#39;)&quot;&gt;&amp;");
    expect(body).toContain("mcp.example");
  });

  it("keeps the page result when the Discord edit fails, because the interaction token may have expired", async () => {
    const { start, report } = harness();
    report.mockImplementation(async () => {
      throw new Error("Invalid Webhook Token");
    });
    warn.mockClear();
    const { state } = await start();
    const connected = await confirm(state, confirmationToken((await callback(state)).body));
    expect(connected.body).toContain(page("success_title"));
    expect(warn).toHaveBeenCalled();
    for (const [message, , context] of warn.mock.calls) {
      expect(JSON.stringify([message, context])).not.toContain(ACCESS_TOKEN);
      expect(JSON.stringify([message, context])).not.toContain(CODE);
    }
  });
});

describe("MCP sign-in routes", () => {
  it("serves the client document only on a public origin and forbids caching and framing", async () => {
    const currentKey = spyOn(keyManager, "getCurrentKey").mockReturnValue("synthetic-encryption-key");
    let server: Server | undefined;
    const realListen = Server.prototype.listen;
    const listen = spyOn(Server.prototype, "listen").mockImplementation(function (this: Server) {
      server = this;
      return this;
    });
    try {
      startHealthServer(0);
    } finally {
      listen.mockRestore();
    }
    if (!server) throw new Error("Health server did not start");
    const activeServer: Server = server;
    try {
      realListen.call(activeServer, { port: 0, host: "127.0.0.1" });
      await once(activeServer, "listening");
      const address = activeServer.address();
      if (!address || typeof address === "string") throw new Error("Missing health server address");
      const base = `http://127.0.0.1:${address.port}`;

      initializeOAuthCallbackRoute();
      initializeMcpOAuthRoutes("http://127.0.0.1:8080");
      const loopbackDocument = await fetch(`${base}/oauth/client.json`);
      expect(loopbackDocument.status).toBe(404);
      await loopbackDocument.text();

      initializeMcpOAuthRoutes(PUBLIC_BASE);
      const document = await fetch(`${base}/oauth/client.json`);
      expect(await document.json()).toEqual({
        client_id: `${PUBLIC_BASE}/oauth/client.json`,
        client_name: "TomoriBot",
        redirect_uris: [`${PUBLIC_BASE}/oauth/callback`],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });

      const state = createSignedOAuthState({
        flow: "mcp",
        subject: "1",
        signerSecret: deriveMcpStateSigner(),
        ttlSeconds: 60,
      }).state;
      const pages = [
        await fetch(`${base}/oauth/callback?state=${encodeURIComponent(state)}&code=x`),
        await fetch(`${base}/oauth/mcp/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ state, confirmation: "x", action: "connect" }),
        }),
      ];
      for (const response of pages) {
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
        expect(await response.text()).toContain(page("expired_title"));
      }
      const oversized = await fetch(`${base}/oauth/mcp/confirm`, { method: "POST", body: "x".repeat(9 * 1024) });
      expect(oversized.status).toBe(413);
      await oversized.text();

      const unknownStart = await fetch(`${base}/oauth/mcp/start?id=unknown`, { redirect: "manual" });
      expect(unknownStart.headers.get("cache-control")).toBe("no-store");
      expect(await unknownStart.text()).toContain(page("expired_title"));
      const { signInUrl, authorizationUrl } = await harness().start();
      const started = await fetch(`${base}/oauth/mcp/start${signInUrl.search}`, { redirect: "manual" });
      expect(started.status).toBe(303);
      expect(started.headers.get("location")).toBe(authorizationUrl.href);
      expect(started.headers.get("cache-control")).toBe("no-store");
      expect(started.headers.get("referrer-policy")).toBe("no-referrer");
      await started.text();
    } finally {
      activeServer.close();
      eventLoopMonitor.stop();
      currentKey.mockRestore();
      clearOAuthCallbackFlowsForTests();
    }
  });
});
