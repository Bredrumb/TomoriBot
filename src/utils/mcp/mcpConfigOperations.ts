import type { GuildMcpServerRow } from "@/types/db/schema";
import type { McpAuthorizationChallenge } from "@/types/tool/mcpTypes";
import { getGuildMcpConfigReadResult, type GuildMcpConfigReadResult } from "@/utils/cache/guildMcpConfigCache";
import { type GuildMcpOAuthGrant, guildMcpOAuthRepository } from "@/utils/db/repositories/GuildMcpOAuthRepository";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { unionMcpScopes } from "@/utils/mcp/oauth/discovery";
import { isMcpSignInAvailable } from "@/utils/mcp/oauth/signIn";
import { normalizeMcpToolNameSnapshot } from "@/utils/mcp/mcpToolSnapshot";
import {
  getEndpointRemotePolicy,
  type RemoteUrlValidationResult,
  validateRemoteUrl,
} from "@/utils/security/remoteUrlSecurity";

export const MAX_MCP_SERVERS_PER_WORKSPACE = Number(process.env.MAX_MCP_SERVERS_PER_GUILD) || 10;
const MCP_SERVER_TYPES = ["general", "web_search", "url_fetcher", "prose_linter"] as const;
export type McpServerType = (typeof MCP_SERVER_TYPES)[number];

const MCP_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,31}$/;

interface McpConnectionTestResult {
  success: boolean;
  toolCount: number;
  functionNames: string[];
  error?: string;
  unauthorized?: McpAuthorizationChallenge;
}

/** A validated registration waiting on sign-in; nothing about it is stored until the grant arrives. */
export interface McpSignInDraft {
  serverId: number;
  serverDiscId: string;
  name: string;
  url: string;
  serverType: McpServerType;
  /** Set by Reconnect, whose grant replaces this registration's instead of adding one. */
  guildMcpId?: number;
}

export interface McpConfigOperationDependencies {
  read(serverId: number, options?: { forceRefresh?: boolean }): Promise<GuildMcpConfigReadResult>;
  validateUrl(url: string): Promise<RemoteUrlValidationResult>;
  testConnection(url: string, authToken?: string): Promise<McpConnectionTestResult>;
  insert(
    serverId: number,
    name: string,
    url: string,
    authToken: string | undefined,
    serverType: string | null,
    lastDiscoveredToolNames: readonly string[],
    serverDiscId: string,
    oauthGrant?: GuildMcpOAuthGrant,
  ): Promise<GuildMcpServerRow | null>;
  signInAvailable(): boolean;
  requestedScopes(guildMcpId: number): Promise<string | null>;
  replaceGrant(
    serverId: number,
    guildMcpId: number,
    grant: GuildMcpOAuthGrant,
    lastDiscoveredToolNames: readonly string[],
    serverDiscId: string,
  ): Promise<GuildMcpServerRow | null>;
  updateEnabled(serverId: number, guildMcpId: number, enabled: boolean, serverDiscId: string): Promise<boolean>;
  remove(serverId: number, guildMcpId: number, serverDiscId: string): Promise<boolean>;
  disconnect(serverId: number, name: string): Promise<void>;
}

export type AddMcpResult =
  | { status: "success"; row: GuildMcpServerRow; test: McpConnectionTestResult }
  | { status: "invalid-input" }
  | { status: "invalid-name" }
  | { status: "invalid-type" }
  | { status: "family-in-use" }
  | { status: "invalid-url"; validation: RemoteUrlValidationResult }
  | { status: "unavailable" }
  | { status: "limit-reached"; max: number }
  | { status: "connection-failed"; error: string; signInHint?: McpSignInHint }
  | { status: "sign-in-required"; draft: McpSignInDraft; challenge: McpAuthorizationChallenge }
  | { status: "duplicate-or-write-failed"; name: string };

/** Why a 401 on add did not become a sign-in: the bot has no callback address, or the workspace is a DM. */
export type McpSignInHint = "unconfigured" | "dm";

export type CompleteMcpSignInResult = Exclude<AddMcpResult, { status: "sign-in-required" }>;

export type ReconnectMcpResult =
  | Extract<AddMcpResult, { status: "sign-in-required" | "connection-failed" }>
  | { status: "not-found" }
  | { status: "unavailable" }
  | { status: "sign-in-unavailable" };

export type McpMutationResult =
  | { status: "success"; row: GuildMcpServerRow }
  | { status: "unchanged"; row: GuildMcpServerRow }
  | { status: "not-found" }
  | { status: "unavailable" }
  | { status: "family-in-use" }
  | { status: "write-failed"; row: GuildMcpServerRow };

function requireStableId(row: GuildMcpServerRow): number | null {
  const id = row.guild_mcp_id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function normalizeMcpName(value: string): string {
  return value.trim().replace(/\s+/g, "-");
}

export function isValidMcpName(value: string): boolean {
  return MCP_NAME_PATTERN.test(value);
}

export function parseMcpServerType(value: string | null | undefined): McpServerType | null {
  if (!value || value === "none" || value === "general") return "general";
  return value === "web_search" || value === "url_fetcher" || value === "prose_linter" ? value : null;
}

function toStoredMcpServerType(value: McpServerType): string | null {
  return value === "general" ? null : value;
}

export function safeMcpEndpoint(url: string): string | null {
  try {
    const parsed = new URL(url);
    const defaultPort =
      (parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80");
    return `${parsed.protocol}//${parsed.hostname}${parsed.port && !defaultPort ? `:${parsed.port}` : ""}`;
  } catch {
    return null;
  }
}

export function sanitizeMcpConnectionError(error: string, submittedUrl: string, authToken?: string): string {
  let sanitized = error;
  if (authToken) sanitized = sanitized.split(authToken).join("[redacted]");
  sanitized = sanitized.split(submittedUrl).join(safeMcpEndpoint(submittedUrl) ?? "[redacted URL]");
  try {
    const parsed = new URL(submittedUrl);
    for (const secret of [parsed.username, parsed.password, parsed.search]) {
      if (secret) sanitized = sanitized.split(secret).join("[redacted]");
    }
  } catch {}
  return sanitized.slice(0, 500);
}

export class McpConfigOperations {
  public constructor(private readonly dependencies: McpConfigOperationDependencies) {}

  public async add(input: {
    serverId: number;
    serverDiscId: string;
    name: string;
    url: string;
    authToken?: string;
    serverType?: string | null;
    /** Guild workspaces only, because a sign-in acts as one external account for every member. */
    allowSignIn?: boolean;
  }): Promise<AddMcpResult> {
    const name = normalizeMcpName(input.name);
    const url = input.url.trim();
    const authToken = input.authToken?.trim() || undefined;
    if (!name || !url || url.length > 500 || (authToken?.length ?? 0) > 500) return { status: "invalid-input" };
    if (!isValidMcpName(name)) return { status: "invalid-name" };

    const serverType = parseMcpServerType(input.serverType);
    if (!serverType) return { status: "invalid-type" };

    const refusal = await this.admit(input.serverId, serverType);
    if (refusal) return refusal;

    const validation = await this.dependencies.validateUrl(url);
    if (!validation.valid) return { status: "invalid-url", validation };

    const test = await this.dependencies.testConnection(url, authToken);
    if (!test.success) {
      let signInHint: McpSignInHint | undefined;
      if (!authToken && test.unauthorized) {
        if (input.allowSignIn && this.dependencies.signInAvailable()) {
          return {
            status: "sign-in-required",
            draft: { serverId: input.serverId, serverDiscId: input.serverDiscId, name, url, serverType },
            challenge: test.unauthorized,
          };
        }
        signInHint = input.allowSignIn ? "unconfigured" : "dm";
      }
      return {
        status: "connection-failed",
        error: sanitizeMcpConnectionError(test.error ?? "Unknown error", url, authToken),
        ...(signInHint ? { signInHint } : {}),
      };
    }

    const row = await this.dependencies.insert(
      input.serverId,
      name,
      url,
      authToken,
      toStoredMcpServerType(serverType),
      normalizeMcpToolNameSnapshot(test.functionNames),
      input.serverDiscId,
    );
    return row ? { status: "success", row, test } : { status: "duplicate-or-write-failed", name };
  }

  public async prepareReconnect(input: {
    serverId: number;
    serverDiscId: string;
    guildMcpId: number;
  }): Promise<ReconnectMcpResult> {
    const current = await this.resolveCurrentRow(input.serverId, input.guildMcpId);
    if (current.status !== "success") return current;
    const { row } = current;
    if (!row.oauth_status) return { status: "not-found" };
    const serverType = parseMcpServerType(row.server_type) ?? "general";
    let requestedScopes: string | null;
    try {
      requestedScopes = await this.dependencies.requestedScopes(input.guildMcpId);
    } catch {
      return { status: "unavailable" };
    }
    const test = await this.dependencies.testConnection(row.url);
    if (!test.unauthorized || !this.dependencies.signInAvailable()) {
      return test.success
        ? { status: "sign-in-unavailable" }
        : { status: "connection-failed", error: sanitizeMcpConnectionError(test.error ?? "Unknown error", row.url) };
    }
    return {
      status: "sign-in-required",
      draft: {
        serverId: input.serverId,
        serverDiscId: input.serverDiscId,
        name: row.name,
        url: row.url,
        serverType,
        guildMcpId: input.guildMcpId,
      },
      challenge: {
        ...test.unauthorized,
        scope: unionMcpScopes(requestedScopes, test.unauthorized.scope),
      },
    };
  }

  /** Admission runs again because other changes may have landed while the admin was signing in. */
  public async completeSignIn(draft: McpSignInDraft, grant: GuildMcpOAuthGrant): Promise<CompleteMcpSignInResult> {
    if (draft.guildMcpId === undefined) {
      const refusal = await this.admit(draft.serverId, draft.serverType);
      if (refusal) return refusal;
    }
    const test = await this.dependencies.testConnection(draft.url, grant.accessToken);
    if (!test.success) {
      return {
        status: "connection-failed",
        error: sanitizeMcpConnectionError(test.error ?? "Unknown error", draft.url, grant.accessToken),
      };
    }
    if (draft.guildMcpId !== undefined) {
      const row = await this.dependencies.replaceGrant(
        draft.serverId,
        draft.guildMcpId,
        grant,
        normalizeMcpToolNameSnapshot(test.functionNames),
        draft.serverDiscId,
      );
      if (!row) return { status: "duplicate-or-write-failed", name: draft.name };
      // Lifts the connect quarantine and drops a pooled connection that was still sending the old grant.
      await this.dependencies.disconnect(draft.serverId, row.name);
      return { status: "success", row, test };
    }
    const row = await this.dependencies.insert(
      draft.serverId,
      draft.name,
      draft.url,
      undefined,
      toStoredMcpServerType(draft.serverType),
      normalizeMcpToolNameSnapshot(test.functionNames),
      draft.serverDiscId,
      grant,
    );
    return row ? { status: "success", row, test } : { status: "duplicate-or-write-failed", name: draft.name };
  }

  private async admit(
    serverId: number,
    serverType: McpServerType,
  ): Promise<Extract<AddMcpResult, { status: "unavailable" | "family-in-use" | "limit-reached" }> | null> {
    const current = await this.dependencies.read(serverId, { forceRefresh: true });
    if (current.status !== "fresh") return { status: "unavailable" };
    if (
      (serverType === "web_search" || serverType === "url_fetcher") &&
      current.configs.some((row) => row.is_enabled && row.server_type === serverType)
    ) {
      return { status: "family-in-use" };
    }
    if (current.configs.length >= MAX_MCP_SERVERS_PER_WORKSPACE) {
      return { status: "limit-reached", max: MAX_MCP_SERVERS_PER_WORKSPACE };
    }
    return null;
  }

  public async setEnabled(input: {
    serverId: number;
    serverDiscId: string;
    guildMcpId: number;
    enabled: boolean;
  }): Promise<McpMutationResult> {
    const row = await this.resolveCurrentRow(input.serverId, input.guildMcpId);
    if (row.status !== "success") return row;
    if (row.row.is_enabled === input.enabled) return { status: "unchanged", row: row.row };
    if (input.enabled && (row.row.server_type === "url_fetcher" || row.row.server_type === "web_search")) {
      if (
        row.configs.some(
          (other) =>
            other.guild_mcp_id !== input.guildMcpId && other.is_enabled && other.server_type === row.row.server_type,
        )
      ) {
        return { status: "family-in-use" };
      }
    }

    const updated = await this.dependencies.updateEnabled(
      input.serverId,
      input.guildMcpId,
      input.enabled,
      input.serverDiscId,
    );
    if (!updated) return { status: "write-failed", row: row.row };
    // Enabling disconnects too: an auto-disabled server keeps its connect quarantine so turns that
    // started before the disable cannot redial it, and only this explicit choice should lift it.
    await this.dependencies.disconnect(input.serverId, row.row.name);
    return { status: "success", row: { ...row.row, is_enabled: input.enabled } };
  }

  public async remove(input: {
    serverId: number;
    serverDiscId: string;
    guildMcpId: number;
  }): Promise<McpMutationResult> {
    const row = await this.resolveCurrentRow(input.serverId, input.guildMcpId);
    if (row.status !== "success") return row;
    const removed = await this.dependencies.remove(input.serverId, input.guildMcpId, input.serverDiscId);
    if (!removed) return { status: "write-failed", row: row.row };
    await this.dependencies.disconnect(input.serverId, row.row.name);
    return { status: "success", row: row.row };
  }

  private async resolveCurrentRow(
    serverId: number,
    guildMcpId: number,
  ): Promise<
    | { status: "success"; row: GuildMcpServerRow; configs: GuildMcpServerRow[] }
    | { status: "not-found" }
    | { status: "unavailable" }
  > {
    if (!Number.isSafeInteger(guildMcpId) || guildMcpId <= 0) return { status: "not-found" };
    const current = await this.dependencies.read(serverId, { forceRefresh: true });
    if (current.status !== "fresh") return { status: "unavailable" };
    const row = current.configs.find((candidate) => requireStableId(candidate) === guildMcpId);
    return row ? { status: "success", row, configs: current.configs } : { status: "not-found" };
  }
}

export const mcpConfigOperations = new McpConfigOperations({
  read: getGuildMcpConfigReadResult,
  validateUrl: (url) => validateRemoteUrl(url, getEndpointRemotePolicy()),
  testConnection: (url, authToken) => getGuildMcpManager().testConnection(url, authToken),
  insert: (serverId, name, url, authToken, serverType, lastDiscoveredToolNames, serverDiscId, oauthGrant) =>
    toolRepository.insertMcpServer(
      serverId,
      name,
      url,
      authToken,
      serverType,
      lastDiscoveredToolNames,
      serverDiscId,
      oauthGrant,
    ),
  signInAvailable: isMcpSignInAvailable,
  requestedScopes: (guildMcpId) => guildMcpOAuthRepository.loadRequestedScopes(guildMcpId),
  replaceGrant: (serverId, guildMcpId, grant, lastDiscoveredToolNames, serverDiscId) =>
    toolRepository.replaceMcpOAuthGrant(serverId, guildMcpId, grant, lastDiscoveredToolNames, serverDiscId),
  updateEnabled: (serverId, guildMcpId, enabled, serverDiscId) =>
    toolRepository.updateMcpServerEnabledById(serverId, guildMcpId, enabled, serverDiscId),
  remove: (serverId, guildMcpId, serverDiscId) =>
    toolRepository.deleteMcpServerById(serverId, guildMcpId, serverDiscId),
  disconnect: (serverId, name) => getGuildMcpManager().disconnectGuildServer(serverId, name),
});
