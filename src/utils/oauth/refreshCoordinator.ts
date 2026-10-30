import type { OAuthFetch } from "@/utils/oauth/oauthFetch";
import { oauthFailureDiagnostics, type OAuthFailureDiagnostics } from "@/utils/oauth/errorDiagnostics";
import {
  OAuthTokenError,
  requestOAuthToken,
  type OAuthClientAuthentication,
  type OAuthTokenWithOptionalExpiry,
} from "@/utils/oauth/tokenEndpoint";

interface OAuthRefreshConnection {
  accessToken: string | null;
  expiresAt: number | null;
  /** Null when the server issued none, so the grant blocks once its access token stops being usable. */
  refreshToken: string | null;
  blocked: boolean;
  retryAt: number | null;
  authentication: OAuthClientAuthentication;
}

export interface OAuthTokenStore {
  withLock<T>(
    operation: (session: {
      load(): Promise<OAuthRefreshConnection | null>;
      /** `expiresAt` is null only for a coordinator call with `optionalExpiresIn`. */
      persist(token: OAuthTokenWithOptionalExpiry, refreshToken: string, expiresAt: Date | null): Promise<void>;
      fail(error: OAuthTokenError): Promise<void>;
    }) => Promise<T>,
  ): Promise<T>;
}

export class OAuthRefreshCoordinator {
  private readonly tokens = new Map<string, { value: string; refreshAt: number }>();
  private readonly pending = new Map<string, Promise<string | null>>();

  /**
   * @param options.optionalExpiresIn - Admits a token without a lifetime, which is then used until the caller
   *   reports it rejected; otherwise a stored token without an expiry is refreshed.
   */
  getAccessToken(options: {
    key: string;
    store: OAuthTokenStore;
    endpoint: string;
    allowedOrigins: readonly string[];
    parameters?: URLSearchParams;
    optionalExpiresIn?: boolean;
    timeoutMs?: number;
    userAgent?: string;
    fetchImpl?: OAuthFetch;
    onFailure: (
      reason: "storage" | "network" | "provider" | "invalid_response",
      disposition: "blocked" | "retry",
      diagnostics?: OAuthFailureDiagnostics,
    ) => void;
  }): Promise<string | null> {
    const cached = this.tokens.get(options.key);
    if (cached && cached.refreshAt > Date.now()) return Promise.resolve(cached.value);
    const pending = this.pending.get(options.key);
    if (pending) return pending;
    const renewal = this.refresh(options).finally(() => this.pending.delete(options.key));
    this.pending.set(options.key, renewal);
    return renewal;
  }

  private async refresh(options: Parameters<OAuthRefreshCoordinator["getAccessToken"]>[0]): Promise<string | null> {
    try {
      const renewed = await options.store.withLock(async (session) => {
        const connection = await session.load();
        if (!connection || connection.blocked) return null;
        if (connection.accessToken && connection.expiresAt === null && options.optionalExpiresIn) {
          return { value: connection.accessToken, expiresAt: Number.POSITIVE_INFINITY };
        }
        if (connection.accessToken && connection.expiresAt && connection.expiresAt > Date.now() + 30_000) {
          return { value: connection.accessToken, expiresAt: connection.expiresAt };
        }
        if (connection.retryAt && connection.retryAt > Date.now()) return null;
        if (connection.refreshToken === null) {
          // A grant without a refresh token can only be renewed by signing in again, exactly as after invalid_grant.
          await session.fail(new OAuthTokenError("blocked", "provider"));
          return null;
        }
        const parameters = new URLSearchParams(options.parameters);
        parameters.set("grant_type", "refresh_token");
        parameters.set("refresh_token", connection.refreshToken);
        let token: OAuthTokenWithOptionalExpiry;
        try {
          const request = { ...options, authentication: connection.authentication, parameters };
          token = options.optionalExpiresIn
            ? await requestOAuthToken({ ...request, optionalExpiresIn: true })
            : await requestOAuthToken({ ...request, optionalExpiresIn: false });
        } catch (error) {
          if (!(error instanceof OAuthTokenError)) throw error;
          await session.fail(error);
          options.onFailure(error.reason, error.disposition);
          return null;
        }
        const expiresAt = token.expires_in === undefined ? null : new Date(Date.now() + token.expires_in * 1000);
        await session.persist(token, token.refresh_token ?? connection.refreshToken, expiresAt);
        return { value: token.access_token, expiresAt: expiresAt?.getTime() ?? Number.POSITIVE_INFINITY };
      });
      if (!renewed) return null;
      this.tokens.set(options.key, {
        value: renewed.value,
        refreshAt: renewed.expiresAt - Math.min(30_000, (renewed.expiresAt - Date.now()) / 2),
      });
      return renewed.value;
    } catch (error) {
      options.onFailure("storage", "retry", oauthFailureDiagnostics(error));
      return null;
    }
  }

  invalidate(key: string, rejectedToken: string): void {
    if (this.tokens.get(key)?.value === rejectedToken) this.tokens.delete(key);
  }

  /** Drops the cached token whatever its value, for a grant that was replaced rather than rejected. */
  forget(key: string): void {
    this.tokens.delete(key);
  }

  clear(): void {
    this.tokens.clear();
    this.pending.clear();
  }
}
