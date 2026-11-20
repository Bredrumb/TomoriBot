import type { SQL } from "bun";
import { invalidateGuildMcpConfigCache } from "@/utils/cache/guildMcpConfigCache";
import { sql } from "@/utils/db/client";
import { guildMcpOAuthRepository as repository } from "@/utils/db/repositories/GuildMcpOAuthRepository";
import type { GuildMcpFetchAuthorization } from "@/utils/mcp/guildMcpFetch";
import { unionMcpScopes } from "@/utils/mcp/oauth/discovery";
import { log } from "@/utils/misc/logger";
import { oauthFailureDiagnostics } from "@/utils/oauth/errorDiagnostics";
import { OAuthRefreshCoordinator, type OAuthTokenStore } from "@/utils/oauth/refreshCoordinator";
import { keyManager } from "@/utils/security/keyManager";

const coordinator = new OAuthRefreshCoordinator();

interface McpOAuthGrantContext {
  guildMcpId: number;
  serverId: number;
  tokenEndpoint: string;
  resource: string;
}

type McpAccessTokenResult = { status: "token"; token: string } | { status: "reauthorization" | "unavailable" };

export interface McpFetchAuthorization extends GuildMcpFetchAuthorization {
  readonly reauthorizationRequired: boolean;
}

function tokenKey(guildMcpId: number): string {
  return String(guildMcpId);
}

/** Config reads carry `oauth_status`, so the cache is invalidated only after a status change commits. */
async function withGrantLock<T>(
  context: McpOAuthGrantContext,
  operation: (tx: SQL, markStatusChanged: () => void) => Promise<T>,
): Promise<T> {
  let statusChanged = false;
  const result = await sql.begin((tx) =>
    operation(tx, () => {
      statusChanged = true;
    }),
  );
  if (statusChanged) invalidateGuildMcpConfigCache(context.serverId);
  return result;
}

function tokenStore(context: McpOAuthGrantContext): OAuthTokenStore {
  return {
    withLock: (operation) =>
      withGrantLock(context, (tx, markStatusChanged) =>
        operation({
          load: async () => {
            const row = await repository.loadForUpdate(tx, context.guildMcpId);
            if (!row || row.needs_reauthorization) return null;
            const accessToken = await repository.decrypt(
              tx,
              row.access_token,
              keyManager.getKey(row.access_token_key_version),
            );
            const refreshToken =
              row.refresh_token && row.refresh_token_key_version !== null
                ? await repository.decrypt(tx, row.refresh_token, keyManager.getKey(row.refresh_token_key_version))
                : null;
            return {
              accessToken,
              expiresAt: row.expires_at?.getTime() ?? null,
              refreshToken,
              blocked: false,
              retryAt: row.retry_at?.getTime() ?? null,
              authentication: { method: "none", clientId: row.client_id },
            };
          },
          persist: (token, refreshToken, expiresAt) =>
            repository.storeRefreshedTokens(
              tx,
              context.guildMcpId,
              { accessToken: token.access_token, refreshToken, expiresAt, grantedScopes: token.scope ?? null },
              keyManager.getCurrentKey(),
              keyManager.getCurrentVersion(),
            ),
          fail: async (error) => {
            const blocked = error.disposition === "blocked";
            await repository.setRefreshState(tx, context.guildMcpId, blocked, blocked ? null : error.retryAt);
            if (blocked) markStatusChanged();
          },
        }),
      ),
  };
}

async function getMcpAccessToken(context: McpOAuthGrantContext): Promise<McpAccessTokenResult> {
  const token = await coordinator.getAccessToken({
    key: tokenKey(context.guildMcpId),
    store: tokenStore(context),
    endpoint: context.tokenEndpoint,
    allowedOrigins: [new URL(context.tokenEndpoint).origin],
    parameters: new URLSearchParams({ resource: context.resource }),
    optionalExpiresIn: true,
    onFailure: (reason, disposition, diagnostics) =>
      log.warn("MCP OAuth refresh failed", undefined, {
        metadata: { guildMcpId: context.guildMcpId, errorClass: reason, disposition, ...diagnostics },
      }),
  });
  if (token) return { status: "token", token };
  try {
    return (await repository.needsReauthorization(context.guildMcpId))
      ? { status: "reauthorization" }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Expires a rejected token so the next read refreshes it once; a grant that cannot refresh needs sign-in instead. */
async function replaceRejectedMcpAccessToken(
  context: McpOAuthGrantContext,
  rejected: string,
): Promise<McpAccessTokenResult> {
  coordinator.invalidate(tokenKey(context.guildMcpId), rejected);
  try {
    await withGrantLock(context, async (tx, markStatusChanged) => {
      const row = await repository.loadForUpdate(tx, context.guildMcpId);
      if (!row || row.needs_reauthorization) return;
      const stored = await repository.decrypt(tx, row.access_token, keyManager.getKey(row.access_token_key_version));
      // A concurrent request already replaced it, so the stored token is the one to retry with.
      if (stored !== rejected) return;
      if (row.refresh_token === null) {
        await repository.requireReauthorization(tx, context.guildMcpId);
        markStatusChanged();
        return;
      }
      await repository.expireAccessToken(tx, context.guildMcpId);
    });
  } catch (error) {
    log.warn("MCP rejected access token could not be recorded", undefined, {
      metadata: { guildMcpId: context.guildMcpId, errorClass: "storage", ...oauthFailureDiagnostics(error) },
    });
    return { status: "unavailable" };
  }
  return getMcpAccessToken(context);
}

/** Records the union of requested and challenged scopes, so Reconnect asks for everything the server wanted. */
async function requireMcpReauthorization(context: McpOAuthGrantContext, challengedScope?: string): Promise<void> {
  coordinator.forget(tokenKey(context.guildMcpId));
  try {
    await withGrantLock(context, async (tx, markStatusChanged) => {
      const row = await repository.loadForUpdate(tx, context.guildMcpId);
      if (!row) return;
      await repository.requireReauthorization(
        tx,
        context.guildMcpId,
        challengedScope ? unionMcpScopes(row.requested_scopes, challengedScope) : undefined,
      );
      markStatusChanged();
    });
  } catch (error) {
    log.warn("MCP reauthorization could not be recorded", undefined, {
      metadata: { guildMcpId: context.guildMcpId, errorClass: "storage", ...oauthFailureDiagnostics(error) },
    });
  }
}

export async function createMcpFetchAuthorization(
  guildMcpId: number,
  serverId: number,
): Promise<McpFetchAuthorization> {
  const endpoint = await repository.loadEndpoint(guildMcpId);
  if (!endpoint) throw new Error("Signed-in MCP registration has no stored grant");
  const context: McpOAuthGrantContext = {
    guildMcpId,
    serverId,
    tokenEndpoint: endpoint.token_endpoint,
    resource: endpoint.resource,
  };
  let reauthorizationRequired = false;
  return {
    get reauthorizationRequired() {
      return reauthorizationRequired;
    },
    token: async () => {
      const result = await getMcpAccessToken(context);
      if (result.status === "token") return result.token;
      reauthorizationRequired ||= result.status === "reauthorization";
      throw new Error(
        result.status === "reauthorization" ? "MCP sign-in must be renewed" : "MCP access token is unavailable",
      );
    },
    replace: async (rejected) => {
      const result = await replaceRejectedMcpAccessToken(context, rejected);
      if (result.status === "token") return result.token;
      reauthorizationRequired ||= result.status === "reauthorization";
      return null;
    },
    reauthorize: async (challengedScope) => {
      reauthorizationRequired = true;
      await requireMcpReauthorization(context, challengedScope);
    },
  };
}

/** Reconnect replaced the grant without anything rejecting the cached token, so `invalidate` would not match it. */
export function forgetMcpAccessToken(guildMcpId: number): void {
  coordinator.forget(tokenKey(guildMcpId));
}

export function clearMcpAccessTokensForTests(): void {
  coordinator.clear();
}
