import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport, SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import { extractWWWAuthenticateParams } from "@modelcontextprotocol/sdk/client/auth.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { type CallableTool, mcpToTool } from "@google/genai";
import { log } from "@/utils/misc/logger";
import type { GuildMcpFailureReason, GuildMcpServerRow } from "@/types/db/schema";
import type {
  GuildMCPConnection,
  GuildMCPTestResult,
  TypedMCPToolResult,
  MCPServerResponse,
} from "@/types/tool/mcpTypes";
import type { ToolContext } from "@/types/tool/interfaces";
import { getGuildMcpConfigReadResult } from "@/utils/cache/guildMcpConfigCache";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { sendToolNotice } from "@/utils/discord/toolProgressNotice";
import { sendFetchProgressNotice } from "@/tools/fetchUrl/fetchProgressNotice";
import { getEndpointRemotePolicy, validateRemoteUrl } from "@/utils/security/remoteUrlSecurity";
import { localizer } from "@/utils/text/localizer";
import { ToolRegistry } from "@/tools/toolRegistry";
import { refreshToolExecutionContext } from "@/tools/availability";
import { configToFeatureFlags } from "@/utils/tools/featureFlagMapper";
import { validateFetchUrlTarget } from "@/tools/fetchUrl/urlSafety";
import { createGuildMcpFetch, type GuildMcpFetchAuthorization } from "@/utils/mcp/guildMcpFetch";
import { createMcpFetchAuthorization, type McpFetchAuthorization } from "@/utils/mcp/oauth/accessToken";

interface GuildMcpRoute {
  config: GuildMcpServerRow;
  connection: GuildMCPConnection;
}

export interface GuildMcpRouting {
  routes: Map<string, GuildMcpRoute>;
  replaced: Set<string>;
}

async function validateReplacementUrls(value: unknown, schema: unknown, propertyName = ""): Promise<void> {
  if (!schema || typeof schema !== "object") return;
  const definition = schema as Record<string, unknown>;
  if (typeof value === "string" && (definition.format === "uri" || /^(url|uri|urls)$/i.test(propertyName))) {
    const result = await validateFetchUrlTarget(value);
    if (!result.allowed) throw new Error(result.error);
  }
  if (Array.isArray(value)) {
    for (const item of value) await validateReplacementUrls(item, definition.items, propertyName);
  } else if (value && typeof value === "object" && definition.properties && typeof definition.properties === "object") {
    for (const [name, childSchema] of Object.entries(definition.properties)) {
      await validateReplacementUrls((value as Record<string, unknown>)[name], childSchema, name);
    }
  }
}

const CONNECTION_TTL_MS = (Number(process.env.GUILD_MCP_CONNECTION_TTL_MINUTES) || 10) * 60 * 1000;

const CONNECT_TIMEOUT_MS = Number(process.env.GUILD_MCP_CONNECT_TIMEOUT_MS) || 15_000;

const EXECUTION_TIMEOUT_MS = Number(process.env.GUILD_MCP_EXECUTION_TIMEOUT_MS) || 30_000;

// Base circuit-breaker quarantine because an unreachable server would otherwise re-pay the connect timeout on every
// generation and fallback model, stalling chat.
const CONNECT_FAILURE_COOLDOWN_MS = Number(process.env.GUILD_MCP_FAILURE_COOLDOWN_MS) || 5 * 60_000;

// Backoff multipliers (5m, 15m, 1h, then repeating 3h at 5m base) are chosen so dead servers take roughly 12 probes
// daily while recovered ones return within 3h.
const CONNECT_FAILURE_BACKOFF_MULTIPLIERS = [1, 3, 12, 36] as const;

// Failure streak start is persisted in the database so restarts and deploys do not reset the 24h window before
// auto-disabling a failing registration.
const AUTO_DISABLE_AFTER_FAILING_MS = 24 * 60 * 60_000;

// In-memory failure entries outlive their retry timestamp by this window so backoff escalation survives quiet hours.
const CONNECT_FAILURE_MEMORY_MS = AUTO_DISABLE_AFTER_FAILING_MS;

interface ConnectFailureState {
  retryAt: number;
  attempts: number;
}

// Structured reason field preserves the failure kind across transport fallback because the error message becomes a
// joined summary.
class GuildMcpConnectError extends Error {
  constructor(
    message: string,
    readonly reason: GuildMcpFailureReason,
  ) {
    super(message);
  }
}

function isAuthRejection(error: unknown): boolean {
  if (!(error instanceof StreamableHTTPError || error instanceof SseError)) return false;
  return error.code === 401 || error.code === 403;
}

const EVICTION_INTERVAL_MS = 60_000;

class GuildMcpManager {
  private static instance: GuildMcpManager;

  private pool = new Map<string, GuildMCPConnection>();

  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  private connectingKeys = new Set<string>();

  // Elapsed failure entries stay in the map until CONNECT_FAILURE_MEMORY_MS expires (cleared only on connect or
  // explicit disconnect) so retries escalate backoff.
  private connectFailures = new Map<string, ConnectFailureState>();

  private constructor() {
    this.evictionTimer = setInterval(() => this.evictIdleConnections(), EVICTION_INTERVAL_MS);
  }

  static getInstance(): GuildMcpManager {
    if (!GuildMcpManager.instance) {
      GuildMcpManager.instance = new GuildMcpManager();
    }
    return GuildMcpManager.instance;
  }

  // Tool names alone never grant reserved-tool ownership because only a unique registration matching the family's
  // server_type may replace it.
  async getGuildMCPRouting(serverId: number): Promise<GuildMcpRouting> {
    const read = await getGuildMcpConfigReadResult(serverId);
    if (read.status !== "fresh") throw new Error("Current MCP registrations unavailable");
    // A prose linter only reviews drafts; author routing would let the model call it (or a sibling
    // tool such as slop-guard's `check_slop_file`, which reads paths on the MCP host).
    const configs = read.configs.filter(
      (config) => config.server_id === serverId && config.is_enabled && config.server_type !== "prose_linter",
    );
    const reserved = ToolRegistry.getReservedToolNames();
    const replaced = new Set(
      configs
        .map((config) => config.server_type)
        .filter((type): type is string => type === "url_fetcher" || type === "web_search"),
    );
    const candidates = new Map<string, GuildMcpRoute[]>();
    for (const config of configs) {
      if (
        replaced.has(config.server_type ?? "") &&
        configs.filter((row) => row.server_type === config.server_type).length !== 1
      )
        continue;
      const callable = await this.getRegisteredTool(config);
      const connection = this.pool.get(this.poolKey(serverId, config.name));
      if (!callable || !connection || connection.guildMcpId !== config.guild_mcp_id) continue;
      for (const name of new Set(connection.functionNames)) {
        const replacesOwnFamily =
          (name === "fetch_url" && config.server_type === "url_fetcher") ||
          (name === "web_search" && config.server_type === "web_search");
        if (reserved.has(name) && !replacesOwnFamily) continue;
        const entries = candidates.get(name) ?? [];
        entries.push({ config, connection });
        candidates.set(name, entries);
      }
    }
    return {
      replaced,
      routes: new Map(
        [...candidates]
          .filter(([, entries]) => entries.length === 1)
          .map(([name, entries]) => [name, entries[0] as GuildMcpRoute]),
      ),
    };
  }

  // Pool lookup verifies guild_mcp_id matches config so a newly created registration with the same name cannot
  // inherit an old pooled binding.
  async getRegisteredTool(config: GuildMcpServerRow, privateFailure = false): Promise<CallableTool | null> {
    if (!config.is_enabled || config.oauth_status === "needs_reauthorization") return null;
    const connection =
      this.pool.get(this.poolKey(config.server_id, config.name)) ?? (await this.connectServer(config, privateFailure));
    return connection && connection.guildMcpId === config.guild_mcp_id
      ? (connection.callableTool as CallableTool)
      : null;
  }

  // Dispatch verifies is_enabled and guild_mcp_id on the pooled connection, while callers must revalidate row
  // ownership beforehand because this method trusts config.
  async callInternalRuleChecker(
    config: GuildMcpServerRow,
    toolName: string,
    text: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const connection = this.pool.get(this.poolKey(config.server_id, config.name));
    if (!config.is_enabled || !connection || connection.guildMcpId !== config.guild_mcp_id)
      throw new Error("Internal rule registration unavailable");
    connection.lastUsedAt = Date.now();
    return CallToolResultSchema.parse(
      await (connection.client as MCPClient).callTool({ name: toolName, arguments: { text } }, CallToolResultSchema, {
        signal,
        timeout: EXECUTION_TIMEOUT_MS,
      }),
    );
  }

  async getGuildMCPTools(serverId: number): Promise<CallableTool[]> {
    const { routes } = await this.getGuildMCPRouting(serverId);
    const groups = new Map<GuildMCPConnection, Set<string>>();
    for (const [name, route] of routes) {
      const names = groups.get(route.connection) ?? new Set<string>();
      names.add(name);
      groups.set(route.connection, names);
    }
    return [...groups].map(([connection, names]) => {
      const callable = connection.callableTool as CallableTool;
      return {
        tool: async () => {
          const declaration = await callable.tool();
          return {
            ...declaration,
            functionDeclarations: declaration.functionDeclarations?.filter((tool) => tool.name && names.has(tool.name)),
          };
        },
        callTool: callable.callTool.bind(callable),
      };
    });
  }

  async getGuildMCPFunctionNames(serverId: number): Promise<string[]> {
    const tools = await this.getGuildMCPTools(serverId);
    const names: string[] = [];

    for (const tool of tools) {
      try {
        const geminiTool = await tool.tool();
        if (geminiTool.functionDeclarations) {
          for (const decl of geminiTool.functionDeclarations) {
            const name = (decl as { name: string }).name;
            names.push(name);
          }
        }
      } catch (error) {
        log.warn("[GuildMcpManager] Failed to extract function names from guild MCP tool", error);
      }
    }

    return names;
  }

  async getGuildMCPFunctionNamesByServerType(serverId: number, serverType: string): Promise<string[]> {
    const { routes } = await this.getGuildMCPRouting(serverId);
    return [...routes].filter(([, route]) => route.config.server_type === serverType).map(([name]) => name);
  }

  async isGuildMCPFunction(serverId: number, functionName: string): Promise<boolean> {
    const names = await this.getGuildMCPFunctionNames(serverId);
    return names.includes(functionName);
  }

  async executeGuildMCPFunction(
    serverId: number,
    functionName: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<TypedMCPToolResult> {
    const executionStartTime = Date.now();

    try {
      const route = (await this.getGuildMCPRouting(serverId)).routes.get(functionName);
      if (context) {
        const current = await refreshToolExecutionContext(context);
        if (!current)
          return {
            success: false,
            error: localizer(context.locale, "tools.execution.unavailable", { tool: functionName }),
          };
        context = current;
      }
      const conn = route?.connection;
      if (route && (route.config.server_type === "url_fetcher" || route.config.server_type === "web_search")) {
        if (!context || !configToFeatureFlags(context.tomoriState.config).web_search) {
          return {
            success: false,
            error: localizer(context?.locale ?? "en-US", "tools.execution.unavailable", { tool: functionName }),
          };
        }
        const declaration = await (route.connection.callableTool as CallableTool).tool();
        const schema = declaration.functionDeclarations?.find((tool) => tool.name === functionName);
        await validateReplacementUrls(args, schema?.parametersJsonSchema ?? schema?.parameters);
      }
      if (!conn) {
        return {
          success: false,
          message: `Guild MCP function '${functionName}' not found in any connected server`,
          error: `Function '${functionName}' not found`,
          data: {
            source: "mcp",
            functionName,
            serverName: `guild:${serverId}`,
            executionTime: Date.now() - executionStartTime,
            status: "failed",
          },
        };
      }

      if (context?.isExecutionCancelled?.()) return { success: false };
      conn.lastUsedAt = Date.now();

      if (context?.channel && context.locale) {
        try {
          if (route?.config.server_type === "url_fetcher" && typeof args.url === "string") {
            await sendFetchProgressNotice(
              context,
              String(args.url || ""),
              "GuildMcpManager",
              Number(args.start_index) || 0,
            );
          } else {
            const formattedArgs = this.formatMcpArgs(args, context.locale);
            await sendToolNotice(
              context,
              "mcp_tool_call",
              {
                titleKey: "tools.mcp.tool_invoke_title",
                titleVars: { server: conn.name, function: functionName },
                description: formattedArgs,
              },
              "GuildMcpManager",
            );
          }
        } catch (embedError) {
          log.warn(`[GuildMcpManager] Failed to send MCP tool embed for ${functionName}:`, embedError);
        }
      }

      log.info(`[GuildMcpManager] Executing guild MCP function: ${functionName} (server: ${conn.name})`);

      if (context?.isExecutionCancelled?.()) return { success: false };
      const currentRegistration = await getGuildMcpConfigReadResult(serverId);
      const stillSelected =
        currentRegistration.status === "fresh" &&
        currentRegistration.configs.some(
          (row) =>
            row.server_id === serverId &&
            row.guild_mcp_id === route?.config.guild_mcp_id &&
            row.is_enabled &&
            row.name === route.config.name &&
            row.server_type === route.config.server_type,
        ) &&
        (!(route?.config.server_type === "url_fetcher" || route?.config.server_type === "web_search") ||
          currentRegistration.configs.filter(
            (row) => row.server_id === serverId && row.is_enabled && row.server_type === route.config.server_type,
          ).length === 1);
      if (!stillSelected)
        return {
          success: false,
          error: localizer(context?.locale ?? "en-US", "tools.execution.unavailable", { tool: functionName }),
        };
      if (context) {
        const current = await refreshToolExecutionContext(context);
        const family = route?.config.server_type === "url_fetcher" || route?.config.server_type === "web_search";
        if (!current || (family && !configToFeatureFlags(current.tomoriState.config).web_search))
          return {
            success: false,
            error: localizer(context.locale, "tools.execution.unavailable", { tool: functionName }),
          };
        context = current;
      }
      if (context?.isExecutionCancelled?.()) return { success: false };
      const mcpResult = CallToolResultSchema.parse(
        await (conn.client as MCPClient).callTool({ name: functionName, arguments: args }, CallToolResultSchema, {
          timeout: EXECUTION_TIMEOUT_MS,
          signal: context?.abortSignal ?? context?.streamContext?.abortSignal,
        }),
      );
      return this.processDefaultResult(functionName, mcpResult, conn.name, executionStartTime, context);
    } catch (error) {
      const executionTime = Date.now() - executionStartTime;
      log.error(`[GuildMcpManager] Guild MCP execution failed: ${functionName}`, error);

      return {
        success: false,
        message: error instanceof Error ? error.message : "Guild MCP execution failed",
        error: error instanceof Error ? error.message : String(error),
        data: {
          source: "mcp",
          functionName,
          serverName: `guild:${serverId}`,
          executionTime,
          status: "failed",
        },
      };
    }
  }

  private formatMcpArgs(args: Record<string, unknown>, locale: string): string {
    const entries = Object.entries(args);

    if (entries.length === 0) {
      return localizer(locale, "tools.mcp.tool_invoke_no_params");
    }

    const MAX_VALUE_LENGTH = 200;
    // Stay at 900 characters because the header and code fences must fit within Discord's 1,024-character field limit.
    const MAX_TOTAL_LENGTH = 900;
    const lines = entries.map(([key, value]) => {
      const stringValue = typeof value === "string" ? value : JSON.stringify(value);
      const truncated =
        stringValue.length > MAX_VALUE_LENGTH ? `${stringValue.substring(0, MAX_VALUE_LENGTH)}...` : stringValue;
      return `${key}: ${truncated}`;
    });

    const header = localizer(locale, "tools.mcp.tool_invoke_description");
    let body = lines.join("\n");

    if (body.length > MAX_TOTAL_LENGTH) {
      body = `${body.substring(0, MAX_TOTAL_LENGTH)}...`;
    }

    return `${header}\n\`\`\`\n${body}\n\`\`\``;
  }

  async testConnection(url: string, authToken?: string): Promise<GuildMCPTestResult> {
    let client: MCPClient | null = null;
    let unauthorized: GuildMCPTestResult["unauthorized"];
    const recordChallenge = (response: Response) => {
      const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response);
      unauthorized ??= {
        ...(resourceMetadataUrl ? { resourceMetadataUrl: resourceMetadataUrl.href } : {}),
        ...(scope ? { scope } : {}),
      };
    };
    try {
      const discovered = await this.connectAndDiscover(
        "tomoribot-test",
        url,
        authToken,
        "test",
        false,
        recordChallenge,
      );
      client = discovered.client;
      const { functionNames } = discovered;

      await client.close();

      return {
        success: true,
        toolCount: functionNames.length,
        functionNames,
      };
    } catch (error) {
      try {
        await client?.close();
      } catch {}

      return {
        success: false,
        toolCount: 0,
        functionNames: [],
        error: error instanceof Error ? error.message : String(error),
        ...(unauthorized ? { unauthorized } : {}),
      };
    }
  }

  async disconnectGuildServer(serverId: number, name: string): Promise<void> {
    const key = this.poolKey(serverId, name);
    // Always clear any quarantine so a fixed/re-added server isn't skipped by the
    // circuit breaker, even if it never made it into the pool.
    this.connectFailures.delete(key);
    const conn = this.pool.get(key);
    if (!conn) return;

    try {
      await (conn.client as MCPClient).close();
    } catch (error) {
      log.warn(`[GuildMcpManager] Error closing connection ${key}`, error);
    }

    this.pool.delete(key);
    log.info(`[GuildMcpManager] Disconnected guild MCP server: ${key}`);
  }

  async eagerConnectAll(configs: GuildMcpServerRow[]): Promise<void> {
    if (configs.length === 0) return;

    log.info(`[GuildMcpManager] Eager-connecting ${configs.length} guild MCP server(s)...`);

    const results = await Promise.allSettled(configs.map((config) => this.connectServer(config)));

    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value !== null).length;
    const failed = results.length - succeeded;

    log.info(`[GuildMcpManager] Eager connect complete: ${succeeded} succeeded, ${failed} failed`);
  }

  async cleanup(): Promise<void> {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }

    const closePromises = Array.from(this.pool.entries()).map(async ([key, conn]) => {
      try {
        await (conn.client as MCPClient).close();
        log.info(`[GuildMcpManager] Closed connection: ${key}`);
      } catch (error) {
        log.warn(`[GuildMcpManager] Error closing connection ${key} during cleanup`, error);
      }
    });

    await Promise.allSettled(closePromises);
    this.pool.clear();
    log.info("[GuildMcpManager] Cleanup complete");
  }

  getPoolStats(): {
    activeConnections: number;
    serverBreakdown: Record<string, number>;
  } {
    const serverBreakdown: Record<string, number> = {};
    for (const conn of this.pool.values()) {
      const key = `server:${conn.serverId}`;
      serverBreakdown[key] = (serverBreakdown[key] || 0) + 1;
    }

    return {
      activeConnections: this.pool.size,
      serverBreakdown,
    };
  }

  private async connectServer(config: GuildMcpServerRow, privateFailure = false): Promise<GuildMCPConnection | null> {
    const key = this.poolKey(config.server_id, config.name);

    const existing = this.pool.get(key);
    if (existing) return existing;
    // An expired grant needs a human rather than a disable, so it never enters the failure streak.
    if (config.oauth_status === "needs_reauthorization") return null;

    // Skip quarantined servers during cooldown because re-paying connect timeouts on every turn stalls chat.
    const failure = this.connectFailures.get(key);
    if (failure && Date.now() < failure.retryAt) return null;

    if (this.connectingKeys.has(key)) {
      log.info(`[GuildMcpManager] Connection already in progress for ${key}, skipping`);
      return null;
    }

    this.connectingKeys.add(key);

    let authorization: McpFetchAuthorization | undefined;
    try {
      if (config.oauth_status) {
        authorization = await createMcpFetchAuthorization(config.guild_mcp_id ?? 0, config.server_id);
      }
      const credential = authorization ?? (await toolRepository.decryptMcpAuthToken(config, privateFailure));

      const { client, functionNames } = await this.connectAndDiscover(
        `tomoribot-guild-${config.server_id}-${config.name}`,
        config.url,
        credential ?? undefined,
        config.name,
        privateFailure,
      );

      const callableTool = mcpToTool(client);

      const conn: GuildMCPConnection = {
        guildMcpId: config.guild_mcp_id ?? 0,
        serverId: config.server_id,
        name: config.name,
        client,
        callableTool,
        functionNames,
        connectedAt: Date.now(),
        lastUsedAt: Date.now(),
      };

      this.pool.set(key, conn);
      client.onerror = (error) => {
        const transport = client.transport;
        if (
          error instanceof StreamableHTTPError &&
          error.code === 404 &&
          transport instanceof StreamableHTTPClientTransport &&
          transport.sessionId &&
          this.pool.get(key) === conn
        ) {
          // Session-scoped 404s force re-handshake, while pool identity prevents stale errors dropping newer clients.
          this.pool.delete(key);
          void this.safeCloseClient(client);
        }
      };
      this.connectFailures.delete(key);
      const guildMcpId = config.guild_mcp_id;
      if (typeof guildMcpId === "number" && Number.isSafeInteger(guildMcpId) && guildMcpId > 0) {
        if (config.failing_since || config.failure_reason) {
          void toolRepository.clearMcpConnectFailure(config.server_id, guildMcpId);
        }
        try {
          void toolRepository
            .updateMcpToolNameSnapshot(config.server_id, guildMcpId, functionNames)
            .then((snapshotResult) => {
              if (snapshotResult === "failed") {
                log.warn(
                  `[GuildMcpManager] Tool-name snapshot refresh failed for MCP server ID ${guildMcpId} ` +
                    `on server ${config.server_id}; keeping the live connection`,
                );
              }
            })
            .catch(() => {
              log.warn(
                `[GuildMcpManager] Tool-name snapshot refresh threw for MCP server ID ${guildMcpId} ` +
                  `on server ${config.server_id}; keeping the live connection`,
              );
            });
        } catch {
          log.warn(
            `[GuildMcpManager] Tool-name snapshot refresh threw for MCP server ID ${guildMcpId} ` +
              `on server ${config.server_id}; keeping the live connection`,
          );
        }
      }
      log.success(
        `[GuildMcpManager] Connected to guild MCP server "${config.name}" ` +
          `(server: ${config.server_id}, tools: ${functionNames.length}: ${functionNames.join(", ")})`,
      );

      return conn;
    } catch (error) {
      if (authorization?.reauthorizationRequired) {
        log.info(
          `[GuildMcpManager] Guild MCP server "${config.name}" (server: ${config.server_id}) needs sign-in again`,
        );
        return null;
      }
      await this.recordConnectFailure(config, key, error, privateFailure);
      return null;
    } finally {
      this.connectingKeys.delete(key);
    }
  }

  // Connection failures stem from guild config or remote hosts rather than bot faults, so only the first failure logs
  // a full warning.
  private async recordConnectFailure(
    config: GuildMcpServerRow,
    key: string,
    error: unknown,
    privateFailure: boolean,
  ): Promise<void> {
    const attempts = (this.connectFailures.get(key)?.attempts ?? 0) + 1;
    const multiplier =
      CONNECT_FAILURE_BACKOFF_MULTIPLIERS[Math.min(attempts, CONNECT_FAILURE_BACKOFF_MULTIPLIERS.length) - 1] ?? 1;
    const retryDelayMs = CONNECT_FAILURE_COOLDOWN_MS * multiplier;
    this.connectFailures.set(key, { retryAt: Date.now() + retryDelayMs, attempts });

    const reason: GuildMcpFailureReason = error instanceof GuildMcpConnectError ? error.reason : "unreachable";
    const label = `"${config.name}" (server: ${config.server_id})`;
    if (!privateFailure) {
      const summary =
        `[GuildMcpManager] Failed to connect to guild MCP server ${label} (${reason}, attempt ${attempts}); ` +
        `retrying in ${Math.round(retryDelayMs / 60_000)}m`;
      if (attempts === 1) log.warn(summary, error);
      else log.info(summary);
    }

    const guildMcpId = config.guild_mcp_id;
    if (typeof guildMcpId !== "number" || !Number.isSafeInteger(guildMcpId) || guildMcpId <= 0) return;
    const recorded = await toolRepository.recordMcpConnectFailure(
      config.server_id,
      guildMcpId,
      reason,
      AUTO_DISABLE_AFTER_FAILING_MS,
    );
    if (recorded.status !== "auto-disabled") return;
    log.warn(
      `[GuildMcpManager] Auto-disabled guild MCP server ${label} after failing since ` +
        `${recorded.failingSince.toISOString()} (${reason})`,
    );
  }

  private async connectAndDiscover(
    clientName: string,
    url: string,
    credential?: string | GuildMcpFetchAuthorization,
    serverLabel?: string,
    privateFailure = false,
    onUnauthorized?: (response: Response) => void,
  ): Promise<{ client: MCPClient; functionNames: string[] }> {
    const client = await this.connectWithFallback(
      clientName,
      url,
      credential,
      serverLabel,
      privateFailure,
      onUnauthorized,
    );
    try {
      const toolResult = await client.listTools();
      return { client, functionNames: toolResult.tools.map((tool) => tool.name) };
    } catch (error) {
      await this.safeCloseClient(client);
      throw error;
    }
  }

  // SSE-only servers reject the Streamable HTTP handshake, so fallback attempts need fresh MCP clients with the same
  // guarded fetcher.
  private async connectWithFallback(
    clientName: string,
    url: string,
    credential?: string | GuildMcpFetchAuthorization,
    serverLabel?: string,
    privateFailure = false,
    onUnauthorized?: (response: Response) => void,
  ): Promise<MCPClient> {
    const label = serverLabel ?? url;
    const urlValidation = await validateRemoteUrl(url, getEndpointRemotePolicy());
    if (!urlValidation.valid) {
      throw new Error(urlValidation.details ?? `Guild MCP URL failed runtime validation for '${label}'.`);
    }

    // Create a fresh MCPClient per transport attempt because the SDK throws if a failed instance is reused.
    const errors: string[] = [];
    let authRejected = false;

    const guardedFetch = createGuildMcpFetch(
      url,
      onUnauthorized,
      typeof credential === "object" ? credential : undefined,
    );

    const headers: Record<string, string> = {};
    if (typeof credential === "string" && credential) {
      headers.Authorization = `Bearer ${credential}`;
    }

    const parsedUrl = new URL(url);
    const requestInit = {
      headers,
      redirect: "error" as const,
    };

    {
      const client = this.newMcpClient(clientName);
      try {
        const streamableTransport = new StreamableHTTPClientTransport(parsedUrl, {
          fetch: guardedFetch,
          requestInit,
        });
        await this.connectWithTimeout(client, streamableTransport, label, "StreamableHTTP");
        log.info(`[GuildMcpManager] Connected via StreamableHTTP: ${label}`);
        return client;
      } catch (streamableError) {
        authRejected ||= isAuthRejection(streamableError);
        const message = privateFailure
          ? "Transport connection failed"
          : streamableError instanceof Error
            ? streamableError.message
            : String(streamableError);
        errors.push(`StreamableHTTP: ${message}`);
        await this.safeCloseClient(client);
        log.info(`[GuildMcpManager] StreamableHTTP failed for "${label}", falling back to SSE: ${message}`);
      }
    }

    {
      const client = this.newMcpClient(clientName);
      try {
        const sseTransport = new SSEClientTransport(parsedUrl, {
          fetch: guardedFetch,
          requestInit,
          eventSourceInit: {
            fetch: guardedFetch,
          },
        });
        await this.connectWithTimeout(client, sseTransport, label, "SSE");
        log.info(`[GuildMcpManager] Connected via SSE fallback: ${label}`);
        return client;
      } catch (sseError) {
        authRejected ||= isAuthRejection(sseError);
        const message = privateFailure
          ? "Transport connection failed"
          : sseError instanceof Error
            ? sseError.message
            : String(sseError);
        errors.push(`SSE: ${message}`);
        await this.safeCloseClient(client);
        throw new GuildMcpConnectError(
          `All MCP transports failed for '${label}': ${errors.join("; ")}`,
          authRejected ? "unauthorized" : "unreachable",
        );
      }
    }
  }

  private newMcpClient(clientName: string): MCPClient {
    return new MCPClient({ name: clientName, version: "1.0.0" });
  }

  private async connectWithTimeout(
    client: MCPClient,
    transport: Parameters<MCPClient["connect"]>[0],
    label: string,
    kind: string,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${kind} connection to '${label}' timed out`)), CONNECT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async safeCloseClient(client: MCPClient): Promise<void> {
    try {
      await client.close();
    } catch {
      // ignore because the client may have no active transport to close
    }
  }

  private async evictIdleConnections(): Promise<void> {
    const now = Date.now();
    const toEvict: string[] = [];

    // Prune long-elapsed circuit-breaker entries so the map stays bounded even for
    // servers that were removed from config and are never dialed again.
    for (const [key, failure] of this.connectFailures.entries()) {
      if (now - failure.retryAt >= CONNECT_FAILURE_MEMORY_MS) {
        this.connectFailures.delete(key);
      }
    }

    for (const [key, conn] of this.pool.entries()) {
      if (now - conn.lastUsedAt > CONNECTION_TTL_MS) {
        toEvict.push(key);
      }
    }

    for (const key of toEvict) {
      const conn = this.pool.get(key);
      if (!conn) continue;

      try {
        await (conn.client as MCPClient).close();
      } catch (error) {
        log.warn(`[GuildMcpManager] Error closing idle connection ${key}`, error);
      }

      this.pool.delete(key);
      log.info(
        `[GuildMcpManager] Evicted idle connection: ${key} ` + `(idle: ${Math.round((now - conn.lastUsedAt) / 1000)}s)`,
      );
    }
  }

  private processDefaultResult(
    functionName: string,
    mcpResult: MCPServerResponse,
    serverName: string,
    executionStartTime: number,
    _context?: ToolContext,
  ): TypedMCPToolResult {
    const executionTime = Date.now() - executionStartTime;

    const text = mcpResult.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    const message =
      text ||
      (mcpResult.structuredContent
        ? JSON.stringify(mcpResult.structuredContent)
        : "Guild MCP function executed successfully");
    if (mcpResult.isError) {
      const error = text || "Guild MCP function execution failed";
      return {
        success: false,
        message: error,
        error,
        data: {
          source: "mcp",
          functionName,
          serverName: `guild:${serverName}`,
          rawResult: mcpResult,
          executionTime,
          status: "failed",
        },
      };
    }

    return {
      success: true,
      message,
      data: {
        source: "mcp",
        functionName,
        serverName: `guild:${serverName}`,
        rawResult: mcpResult,
        executionTime,
        summary: message,
        status: "completed",
      },
    };
  }

  private poolKey(serverId: number, name: string): string {
    return `${serverId}:${name}`;
  }
}

export function getGuildMcpManager(): GuildMcpManager {
  return GuildMcpManager.getInstance();
}
