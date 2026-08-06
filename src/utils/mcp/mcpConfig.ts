/**
 * MCP Configuration Utilities
 * Unified configuration loading and management for MCP servers
 * Bridges the gap between JSON config files and mcpManager implementation
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { log } from "../misc/logger";
import type { EnhancedMCPServerConfig } from "../../types/tool/mcpTypes";

/**
 * MCP Configuration Manager
 * Handles loading, validation, and management of MCP server configurations
 */
export class MCPConfigManager {
  private static instance: MCPConfigManager;
  private configCache: Map<string, EnhancedMCPServerConfig> = new Map();
  private readonly MCP_SERVERS_DIR = join(process.cwd(), "src", "tools", "mcpServers");

  static getInstance(): MCPConfigManager {
    if (!MCPConfigManager.instance) {
      MCPConfigManager.instance = new MCPConfigManager();
    }
    return MCPConfigManager.instance;
  }

  /**
   * Private constructor
   */
  private constructor() {
    this.loadAllConfigurations();
  }

  /**
   * Load all MCP server configurations from the file system
   */
  private loadAllConfigurations(): void {
    try {
      if (!existsSync(this.MCP_SERVERS_DIR)) {
        log.warn("MCP servers directory not found:", this.MCP_SERVERS_DIR);
        return;
      }

      const serverDirs = readdirSync(this.MCP_SERVERS_DIR).filter((item) => {
        const fullPath = join(this.MCP_SERVERS_DIR, item);
        return statSync(fullPath).isDirectory();
      });

      let loadedCount = 0;
      for (const serverDir of serverDirs) {
        try {
          const config = this.loadServerConfiguration(serverDir);
          if (config) {
            this.configCache.set(serverDir, config);
            loadedCount++;
          }
        } catch (error) {
          log.warn(`Failed to load configuration for MCP server '${serverDir}':`, error as Error);
        }
      }

      log.info(`MCP Config Manager loaded ${loadedCount}/${serverDirs.length} server configurations`);
    } catch (error) {
      log.error("Failed to load MCP configurations:", error as Error);
    }
  }

  /**
   * @returns Enhanced server configuration or null if not found/invalid
   */
  private loadServerConfiguration(serverName: string): EnhancedMCPServerConfig | null {
    try {
      const configPath = join(this.MCP_SERVERS_DIR, serverName, "config.json");

      if (!existsSync(configPath)) {
        log.info(`No config.json found for MCP server: ${serverName}`);
        return null;
      }

      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const enhancedConfig = this.validateAndEnhanceConfig(rawConfig, serverName);

      log.info(`Loaded configuration for MCP server: ${serverName}`);
      return enhancedConfig;
    } catch (error) {
      log.error(`Failed to load config for ${serverName}:`, error as Error);
      return null;
    }
  }

  /**
   * Validate and enhance a raw configuration object
   * @param rawConfig - Raw configuration from JSON file
   */
  private validateAndEnhanceConfig(rawConfig: Record<string, unknown>, serverName: string): EnhancedMCPServerConfig {
    const requiredFields = ["name", "displayName", "description", "enabled"];
    for (const field of requiredFields) {
      if (!(field in rawConfig)) {
        throw new Error(`Missing required field '${field}' in config for ${serverName}`);
      }
    }

    // Ensure arrays exist
    const requiredEnvVars = Array.isArray(rawConfig.requiredEnvVars) ? rawConfig.requiredEnvVars : [];
    const optionalEnvVars = Array.isArray(rawConfig.optionalEnvVars) ? rawConfig.optionalEnvVars : [];

    const enhancedConfig: EnhancedMCPServerConfig = {
      name: typeof rawConfig.name === "string" ? rawConfig.name : serverName,
      displayName: typeof rawConfig.displayName === "string" ? rawConfig.displayName : serverName,
      description: typeof rawConfig.description === "string" ? rawConfig.description : "",
      requiredEnvVars,
      optionalEnvVars,
      enabled: Boolean(rawConfig.enabled),
      category:
        typeof rawConfig.category === "string" &&
        ["search", "utility", "media", "ai", "data"].includes(rawConfig.category)
          ? (rawConfig.category as "search" | "utility" | "media" | "ai" | "data")
          : "utility",
      priority: typeof rawConfig.priority === "number" ? rawConfig.priority : 5,
      transport:
        typeof rawConfig.transport === "string" && ["stdio", "http", "websocket"].includes(rawConfig.transport)
          ? (rawConfig.transport as "stdio" | "http" | "websocket")
          : "stdio",

      npmPackage: typeof rawConfig.npmPackage === "string" ? rawConfig.npmPackage : undefined,
      command: typeof rawConfig.command === "string" ? rawConfig.command : undefined,
      args: Array.isArray(rawConfig.args) ? rawConfig.args : [],
      timeout: typeof rawConfig.timeout === "number" ? rawConfig.timeout : 30000,

      behaviorHandler: this.determineBehaviorHandler(serverName),

      supportedFunctions: Array.isArray(rawConfig.supportedFunctions) ? rawConfig.supportedFunctions : [],
      requiresAuth: requiredEnvVars.length > 0,
      rateLimited: typeof rawConfig.rateLimited === "boolean" ? rawConfig.rateLimited : false,
    };

    this.validateConfiguration(enhancedConfig);

    return enhancedConfig;
  }

  /**
   * Determine the behavior handler class name for a server
   * @returns Handler class name or undefined
   */
  private determineBehaviorHandler(serverName: string): string | undefined {
    const handlerMap: Record<string, string> = {
      "brave-search": "BraveSearchHandler",
      "duckduckgo-search": "DuckDuckGoHandler",
    };

    return handlerMap[serverName];
  }

  /**
   * @throws Error if configuration is invalid
   */
  private validateConfiguration(config: EnhancedMCPServerConfig): void {
    const validTransports = ["stdio", "http", "websocket"];
    if (!validTransports.includes(config.transport)) {
      throw new Error(`Invalid transport '${config.transport}' for ${config.name}`);
    }

    const validCategories = ["search", "utility", "media", "ai", "data"];
    if (!validCategories.includes(config.category)) {
      throw new Error(`Invalid category '${config.category}' for ${config.name}`);
    }

    if (config.priority < 1 || config.priority > 10) {
      throw new Error(`Priority must be between 1-10 for ${config.name}`);
    }

    if (!config.npmPackage && !config.command) {
      throw new Error(`Either npmPackage or command must be specified for ${config.name}`);
    }
  }

  /**
   * Get all available server configurations
   * @param enabledOnly - Whether to return only enabled servers
   */
  public getAllConfigurations(enabledOnly = false): EnhancedMCPServerConfig[] {
    const configs = Array.from(this.configCache.values());
    return enabledOnly ? configs.filter((config) => config.enabled) : configs;
  }

  /**
   * @returns Server configuration or null if not found
   */
  public getConfiguration(serverName: string): EnhancedMCPServerConfig | null {
    return this.configCache.get(serverName) || null;
  }

  /**
   * @param enabledOnly - Whether to return only enabled servers
   * @returns Array of configurations sorted by priority (1 = highest priority)
   */
  public getConfigurationsByPriority(enabledOnly = false): EnhancedMCPServerConfig[] {
    const configs = this.getAllConfigurations(enabledOnly);
    return configs.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get configurations for servers that require API keys
   */
  public getAuthRequiredConfigurations(): EnhancedMCPServerConfig[] {
    return this.getAllConfigurations(true).filter((config) => config.requiresAuth);
  }

  /**
   * Convert enhanced configuration to the format expected by mcpManager
   */
  public toManagerConfiguration(config: EnhancedMCPServerConfig): {
    name: string;
    displayName: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    requiresApiKey?: boolean;
    apiKeyEnvVar?: string;
    timeout?: number;
  } {
    let command: string;
    let args: string[];

    const isProductionRuntime = process.env.RUN_ENV === "production" || process.env.NODE_ENV === "production";

    if (isProductionRuntime && config.command) {
      // In production, prefer explicit binaries installed in the image
      // to avoid bunx cold-cache/network startup delays.
      command = config.command;
      args = config.args || [];
    } else if (config.npmPackage) {
      // Use bunx for npm packages to avoid npm parsing project overrides.
      // This project is Bun-based and bunx runs MCP packages directly.
      command = "bunx";
      args = [config.npmPackage];
    } else if (config.command) {
      command = config.command;
      args = config.args || [];
    } else {
      throw new Error(`No command configuration for server: ${config.name}`);
    }

    const env: Record<string, string> = {};

    for (const envVar of config.requiredEnvVars) {
      const value = process.env[envVar];
      if (value) {
        env[envVar] = value;
      }
    }

    for (const envVar of config.optionalEnvVars) {
      const value = process.env[envVar];
      if (value) {
        env[envVar] = value;
      }
    }

    if (config.name === "brave-search") {
      env.BRAVE_MCP_TRANSPORT = "stdio"; // Force STDIO mode for consistency
    }

    return {
      name: config.name,
      displayName: config.displayName,
      command,
      args,
      env: Object.keys(env).length > 0 ? env : undefined,
      requiresApiKey: config.requiresAuth,
      apiKeyEnvVar: config.requiredEnvVars[0], // First required env var is typically the API key
      timeout: config.timeout,
    };
  }

  /**
   * Check if a server should be initialized based on environment
   */
  public shouldInitializeServer(config: EnhancedMCPServerConfig): boolean {
    if (!config.enabled) {
      return false;
    }

    for (const envVar of config.requiredEnvVars) {
      if (!process.env[envVar]) {
        log.info(`Skipping ${config.displayName}: missing required environment variable ${envVar}`);
        return false;
      }
    }

    return true;
  }

  public getInitializationSummary(): {
    totalServers: number;
    enabledServers: number;
    readyToInitialize: number;
    missingApiKeys: string[];
    disabledServers: string[];
  } {
    const allConfigs = this.getAllConfigurations();
    const enabledConfigs = allConfigs.filter((c) => c.enabled);
    const readyConfigs = enabledConfigs.filter((c) => this.shouldInitializeServer(c));

    const missingApiKeys = enabledConfigs
      .filter((c) => !this.shouldInitializeServer(c))
      .filter((c) => c.requiresAuth)
      .map((c) => c.name);

    const disabledServers = allConfigs.filter((c) => !c.enabled).map((c) => c.name);

    return {
      totalServers: allConfigs.length,
      enabledServers: enabledConfigs.length,
      readyToInitialize: readyConfigs.length,
      missingApiKeys,
      disabledServers,
    };
  }

  public reloadConfigurations(): number {
    this.configCache.clear();
    this.loadAllConfigurations();
    return this.configCache.size;
  }
}

/**
 * Export convenience function for getting the manager instance
 */
export function getMCPConfigManager(): MCPConfigManager {
  return MCPConfigManager.getInstance();
}
