import { hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { startAuthorization } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpAuthorizationChallenge } from "@/types/tool/mcpTypes";
import type { GuildMcpOAuthGrant } from "@/utils/db/repositories/GuildMcpOAuthRepository";
import { oauthStateRepository } from "@/utils/db/repositories/OAuthStateRepository";
import type { CompleteMcpSignInResult, McpSignInDraft } from "@/utils/mcp/mcpConfigOperations";
import { resolveMcpOAuthClientId } from "@/utils/mcp/oauth/clientIdentity";
import {
  discoverMcpAuthorizationServer,
  McpOAuthDiscoveryError,
  type McpAuthorizationServer,
} from "@/utils/mcp/oauth/discovery";
import { renderMcpOAuthConfirmPage, renderMcpOAuthResultPage } from "@/utils/mcp/oauth/pages";
import { log } from "@/utils/misc/logger";
import { OAuthAuthorizationError, parseOAuthAuthorizationResponse } from "@/utils/oauth/authorizationResponse";
import type { OAuthCallbackResponse } from "@/utils/oauth/callbackRoute";
import { oauthFailureDiagnostics } from "@/utils/oauth/errorDiagnostics";
import type { OAuthFetch } from "@/utils/oauth/oauthFetch";
import { OAUTH_CALLBACK_PATH } from "@/utils/oauth/settings";
import {
  createAndPersistOAuthState,
  type OAuthStateNonceRepository,
  validateAndConsumeOAuthState,
  validateSignedOAuthState,
} from "@/utils/oauth/state";
import { OAuthTokenError, requestOAuthToken } from "@/utils/oauth/tokenEndpoint";
import { keyManager } from "@/utils/security/keyManager";

export const MCP_OAUTH_FLOW = "mcp";
export const MCP_OAUTH_CONFIRM_PATH = "/oauth/mcp/confirm";
/** Discord caps button URLs at 512 characters and authorization URLs run longer, so the button opens this redirect. */
export const MCP_OAUTH_START_PATH = "/oauth/mcp/start";

/** Short enough that the callback usually lands inside Discord's 15-minute interaction token. */
const MCP_SIGN_IN_TTL_SECONDS = 10 * 60;

const MCP_STATE_SIGNER_INFO = "tomoribot oauth state signer: mcp";

export type McpSignInOutcome =
  | { status: "completed"; result: CompleteMcpSignInResult }
  | { status: "declined" | "cancelled" | "failed" };

export type McpSignInStart = { status: "started"; signInUrl: string; host: string } | { status: "unavailable" };

export interface McpSignInRequest {
  draft: McpSignInDraft & { guildName: string };
  challenge: McpAuthorizationChallenge;
  locale: string;
  /** Edits the admin's original Discord reply; a failure here never changes the sign-in result. */
  report(outcome: McpSignInOutcome): Promise<void>;
}

export interface McpSignInDependencies {
  complete(draft: McpSignInDraft, grant: GuildMcpOAuthGrant): Promise<CompleteMcpSignInResult>;
  discover(serverUrl: string, challenge: McpAuthorizationChallenge): Promise<McpAuthorizationServer>;
  resolveClientId(server: McpAuthorizationServer, publicBaseUrl: string): Promise<string>;
  stateRepository: OAuthStateNonceRepository;
  tokenFetch?: OAuthFetch;
  now(): Date;
}

interface PendingMcpSignIn extends Pick<McpSignInRequest, "draft" | "locale" | "report"> {
  expiresAt: number;
  authorizationUrl: string;
  issuer: string;
  issParameterSupported: boolean;
  tokenEndpoint: string;
  resource: string;
  scope: string | undefined;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  awaiting?: { code: string; confirmation: string };
}

interface McpSignInRuntime {
  publicBaseUrl: string;
  signerSecret: string;
  dependencies: McpSignInDependencies;
}

let runtime: McpSignInRuntime | null = null;

/**
 * In-flight sign-ins keyed by state nonce hash. They hold the PKCE verifier and the code for minutes
 * only, so a restart or a second bot instance loses them and the admin starts again; a
 * multi-instance deployment is the trigger to move them into shared storage.
 */
const pendingSignIns = new Map<string, PendingMcpSignIn>();

/** A public MCP client has no secret to sign state with; a key rotation only voids sign-ins in flight. */
export function deriveMcpStateSigner(key = keyManager.getCurrentKey()): string {
  return Buffer.from(hkdfSync("sha256", key, "", MCP_STATE_SIGNER_INFO, 32)).toString("base64url");
}

export function configureMcpSignIn(options: {
  publicBaseUrl: string;
  signerSecret: string;
  dependencies: Pick<McpSignInDependencies, "complete"> & Partial<McpSignInDependencies>;
}): void {
  runtime = {
    publicBaseUrl: options.publicBaseUrl,
    signerSecret: options.signerSecret,
    dependencies: {
      discover: (serverUrl, challenge) => discoverMcpAuthorizationServer(serverUrl, challenge),
      resolveClientId: (server, publicBaseUrl) => resolveMcpOAuthClientId(server, publicBaseUrl),
      stateRepository: oauthStateRepository,
      now: () => new Date(),
      ...options.dependencies,
    },
  };
}

/** Sign-in exists only once its callback routes are registered, which needs a public base URL. */
export function isMcpSignInAvailable(): boolean {
  return runtime !== null;
}

export function resetMcpSignInForTests(): void {
  runtime = null;
  pendingSignIns.clear();
}

function liveSignIn(nonceHash: string, now: Date): PendingMcpSignIn | undefined {
  const record = pendingSignIns.get(nonceHash);
  if (record && record.expiresAt <= now.getTime()) {
    pendingSignIns.delete(nonceHash);
    return undefined;
  }
  return record;
}

function pruneExpiredSignIns(now: Date): void {
  for (const [nonceHash, record] of pendingSignIns) {
    if (record.expiresAt <= now.getTime()) pendingSignIns.delete(nonceHash);
  }
}

function singleValue(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

function confirmationMatches(submitted: string, expected: string): boolean {
  const actual = Buffer.from(submitted);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

async function report(record: PendingMcpSignIn, outcome: McpSignInOutcome): Promise<void> {
  try {
    await record.report(outcome);
  } catch (error) {
    // Only a warning because the callback page already shows the result when the interaction token has expired.
    log.warn("MCP sign-in result could not be shown in Discord", undefined, {
      metadata: { serverId: record.draft.serverId, outcome: outcome.status, ...oauthFailureDiagnostics(error) },
    });
  }
}

export async function startMcpSignIn(request: McpSignInRequest): Promise<McpSignInStart> {
  if (!runtime) return { status: "unavailable" };
  const { publicBaseUrl, signerSecret, dependencies } = runtime;
  const host = new URL(request.draft.url).host;
  let step: "discovery" | "client" | "authorization" = "discovery";
  try {
    const server = await dependencies.discover(request.draft.url, request.challenge);
    step = "client";
    const clientId = await dependencies.resolveClientId(server, publicBaseUrl);
    step = "authorization";
    const now = dependencies.now();
    const { state, nonceHash } = await createAndPersistOAuthState({
      flow: MCP_OAUTH_FLOW,
      subject: request.draft.serverDiscId,
      signerSecret,
      ttlSeconds: MCP_SIGN_IN_TTL_SECONDS,
      locale: request.locale,
      now,
      stateRepository: dependencies.stateRepository,
    });
    const redirectUri = `${publicBaseUrl}${OAUTH_CALLBACK_PATH}`;
    const { authorizationUrl, codeVerifier } = await startAuthorization(server.issuer, {
      metadata: server.metadata,
      clientInformation: { client_id: clientId },
      redirectUrl: redirectUri,
      scope: server.scope,
      state,
      resource: server.resource,
    });
    pruneExpiredSignIns(now);
    pendingSignIns.set(nonceHash, {
      draft: request.draft,
      locale: request.locale,
      report: request.report,
      expiresAt: now.getTime() + MCP_SIGN_IN_TTL_SECONDS * 1000,
      authorizationUrl: authorizationUrl.href,
      issuer: server.issuer,
      issParameterSupported: server.issParameterSupported,
      tokenEndpoint: server.tokenEndpoint,
      resource: server.resource,
      scope: server.scope,
      clientId,
      redirectUri,
      codeVerifier,
    });
    return { status: "started", signInUrl: `${publicBaseUrl}${MCP_OAUTH_START_PATH}?id=${nonceHash}`, host };
  } catch (error) {
    log.warn("MCP sign-in could not start", undefined, {
      metadata: {
        serverId: request.draft.serverId,
        host,
        step,
        ...(error instanceof McpOAuthDiscoveryError ? { reason: error.message } : {}),
        ...oauthFailureDiagnostics(error),
      },
    });
    return { status: "unavailable" };
  }
}

/** Only a sign-in still waiting for its callback redirects, so a used or expired link shows the expired page. */
export function findMcpAuthorizationUrl(nonceHash: string): string | null {
  if (!runtime) return null;
  const record = liveSignIn(nonceHash, runtime.dependencies.now());
  return record && !record.awaiting ? record.authorizationUrl : null;
}

/**
 * Holds the code instead of exchanging it: an attacker who sent this link would pass every state,
 * PKCE, and issuer check, so the confirmation page is the only point where the admin can notice.
 */
export async function handleMcpOAuthCallback(url: URL): Promise<OAuthCallbackResponse> {
  if (!runtime) return renderMcpOAuthResultPage("en-US", "expired");
  const { signerSecret, dependencies } = runtime;
  const state = singleValue(url.searchParams, "state") ?? "";
  const now = dependencies.now();
  const validation = validateSignedOAuthState(state, signerSecret, now, MCP_OAUTH_FLOW);
  if (!validation.valid) return renderMcpOAuthResultPage("en-US", "expired");
  const locale = validation.payload.locale ?? "en-US";
  const record = liveSignIn(validation.nonceHash, now);
  if (!record || record.awaiting) return renderMcpOAuthResultPage(locale, "expired");

  let code: string;
  try {
    code = parseOAuthAuthorizationResponse(url.searchParams, {
      state,
      issuer: record.issuer,
      requireIssuer: record.issParameterSupported,
    });
  } catch (error) {
    pendingSignIns.delete(validation.nonceHash);
    const reason = error instanceof OAuthAuthorizationError ? error.reason : "unknown";
    const declined = reason === "denied" && url.searchParams.get("error") === "access_denied";
    if (!declined) {
      log.warn("MCP sign-in callback was rejected", undefined, {
        metadata: { serverId: record.draft.serverId, reason },
      });
    }
    await report(record, { status: declined ? "declined" : "failed" });
    return renderMcpOAuthResultPage(locale, declined ? "declined" : "failed");
  }

  const confirmation = randomBytes(32).toString("base64url");
  record.awaiting = { code, confirmation };
  return renderMcpOAuthConfirmPage({
    locale,
    guild: record.draft.guildName,
    host: new URL(record.draft.url).host,
    confirmPath: MCP_OAUTH_CONFIRM_PATH,
    state,
    // The state alone is known to whoever started the flow, so only the browser that saw this page can confirm.
    confirmation,
  });
}

export async function handleMcpOAuthConfirm(form: URLSearchParams): Promise<OAuthCallbackResponse> {
  if (!runtime) return renderMcpOAuthResultPage("en-US", "expired");
  const { signerSecret, dependencies } = runtime;
  const state = singleValue(form, "state");
  const confirmation = singleValue(form, "confirmation");
  const action = singleValue(form, "action");
  if (!state || !confirmation || (action !== "connect" && action !== "cancel")) {
    return renderMcpOAuthResultPage("en-US", "expired");
  }
  const now = dependencies.now();
  const validation = validateSignedOAuthState(state, signerSecret, now, MCP_OAUTH_FLOW);
  if (!validation.valid) return renderMcpOAuthResultPage("en-US", "expired");
  const locale = validation.payload.locale ?? "en-US";
  const record = liveSignIn(validation.nonceHash, now);
  if (!record?.awaiting || !confirmationMatches(confirmation, record.awaiting.confirmation)) {
    return renderMcpOAuthResultPage(locale, "expired");
  }
  // Taken before any await, so a second submit of the same form finds nothing to exchange.
  pendingSignIns.delete(validation.nonceHash);
  const { code } = record.awaiting;

  try {
    const consumed = await validateAndConsumeOAuthState(
      state,
      signerSecret,
      dependencies.stateRepository,
      now,
      MCP_OAUTH_FLOW,
    );
    if (!consumed.valid) {
      await report(record, { status: "failed" });
      return renderMcpOAuthResultPage(locale, "expired");
    }
    if (action === "cancel") {
      await report(record, { status: "cancelled" });
      return renderMcpOAuthResultPage(locale, "cancelled");
    }
    const token = await requestOAuthToken({
      endpoint: record.tokenEndpoint,
      allowedOrigins: [new URL(record.tokenEndpoint).origin],
      authentication: { method: "none", clientId: record.clientId },
      optionalExpiresIn: true,
      fetchImpl: dependencies.tokenFetch,
      parameters: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: record.redirectUri,
        code_verifier: record.codeVerifier,
        resource: record.resource,
      }),
    });
    const result = await dependencies.complete(record.draft, {
      issuer: record.issuer,
      tokenEndpoint: record.tokenEndpoint,
      resource: record.resource,
      clientId: record.clientId,
      requestedScopes: record.scope ?? null,
      grantedScopes: token.scope ?? null,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: token.expires_in === undefined ? null : new Date(now.getTime() + token.expires_in * 1000),
    });
    await report(record, { status: "completed", result });
    return result.status === "success"
      ? renderMcpOAuthResultPage(locale, "success", { name: result.row.name, guild: record.draft.guildName })
      : renderMcpOAuthResultPage(locale, "failed");
  } catch (error) {
    log.warn("MCP sign-in could not finish", undefined, {
      metadata: {
        serverId: record.draft.serverId,
        host: new URL(record.draft.url).host,
        ...(error instanceof OAuthTokenError ? { reason: error.reason, status: error.status } : {}),
        ...oauthFailureDiagnostics(error),
      },
    });
    await report(record, { status: "failed" });
    return renderMcpOAuthResultPage(locale, "failed");
  }
}
