import { getMCPManager } from "../../utils/mcp/mcpManager";
import { getGuildMcpManager } from "../../utils/mcp/guildMcpManager";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { statRepository } from "@/utils/db/repositories/StatRepository";
import { log } from "../../utils/misc/logger";
import type { ErrorContext } from "../../types/db/schema";
import { registerMCPAdapter } from "../../tools/toolRegistry";
import { getGoogleToolAdapter } from "../../providers/google/googleToolAdapter";
import { getOpenrouterToolAdapter } from "../../providers/openrouter/openrouterToolAdapter";
import { getNovelaiToolAdapter } from "../../providers/novelai/novelaiToolAdapter";
import { getDeepseekToolAdapter } from "../../providers/deepseek/deepseekToolAdapter";
import { getCustomToolAdapter } from "../../providers/custom/customToolAdapter";
import { getNvidiaToolAdapter } from "../../providers/nvidia/nvidiaToolAdapter";
import { getZaiToolAdapter } from "../../providers/zai/zaiToolAdapter";
import { getZaicodingToolAdapter } from "../../providers/zaicoding/zaicodingToolAdapter";
import { getVertexToolAdapter } from "../../providers/vertex/vertexToolAdapter";
import { getVertexexpressToolAdapter } from "../../providers/vertexexpress/vertexexpressToolAdapter";
import { getAnthropicToolAdapter } from "../../providers/anthropic/anthropicToolAdapter";

/**
 * Event handler for initializing MCP servers when the bot is ready
 * This runs during startup to establish connections to external MCP servers
 * and make their tools available for AI function calling
 */
export default async (): Promise<void> => {
  try {
    log.section("Initializing MCP servers");

    const googleAdapter = getGoogleToolAdapter();
    registerMCPAdapter(googleAdapter);
    log.info("Registered Google tool adapter with MCP capabilities");

    const openrouterAdapter = getOpenrouterToolAdapter();
    registerMCPAdapter(openrouterAdapter);
    log.info("Registered OpenRouter tool adapter with MCP capabilities");

    const novelaiAdapter = getNovelaiToolAdapter();
    registerMCPAdapter(novelaiAdapter);
    log.info("Registered NovelAI tool adapter with MCP capabilities");

    const deepseekAdapter = getDeepseekToolAdapter();
    registerMCPAdapter(deepseekAdapter);
    log.info("Registered DeepSeek tool adapter with MCP capabilities");

    const customAdapter = getCustomToolAdapter();
    registerMCPAdapter(customAdapter);
    log.info("Registered Custom tool adapter with MCP capabilities");

    const nvidiaAdapter = getNvidiaToolAdapter();
    registerMCPAdapter(nvidiaAdapter);
    log.info("Registered NVIDIA tool adapter with MCP capabilities");

    const zaiAdapter = getZaiToolAdapter();
    registerMCPAdapter(zaiAdapter);
    log.info("Registered Zai tool adapter with MCP capabilities");

    const zaicodingAdapter = getZaicodingToolAdapter();
    registerMCPAdapter(zaicodingAdapter);
    log.info("Registered Z.ai Coding tool adapter with MCP capabilities");

    const vertexAdapter = getVertexToolAdapter();
    registerMCPAdapter(vertexAdapter);
    log.info("Registered Vertex tool adapter with MCP capabilities");

    const vertexexpressAdapter = getVertexexpressToolAdapter();
    registerMCPAdapter(vertexexpressAdapter);
    log.info("Registered Vertex AI Express tool adapter with MCP capabilities");

    const anthropicAdapter = getAnthropicToolAdapter();
    registerMCPAdapter(anthropicAdapter);
    log.info("Registered Anthropic tool adapter with MCP capabilities");

    const mcpManager = getMCPManager();

    // Initialize all configured MCP servers
    // This will attempt to connect to Brave Search (if API key available) and Fetch servers
    await mcpManager.initializeMCPServers();

    const connectedCount = mcpManager.getConnectedServerCount();
    const connectionStatus = mcpManager.getConnectionStatus();

    if (connectedCount > 0) {
      const connectedServers = Object.keys(connectionStatus).join(", ");
      log.success(`MCP initialization completed - ${connectedCount} server(s) connected: ${connectedServers}`);

      const availableTools = mcpManager.getMCPTools();
      if (availableTools.length > 0) {
        log.info(`MCP tools are now available for function calling (${availableTools.length} tools loaded)`);
      }
    } else {
      log.info("No MCP servers connected - this is normal if API keys are not configured");
    }

    const guildMcpManager = getGuildMcpManager();

    // Register cleanup hook for graceful shutdown
    // Uses "once" to avoid double-fire, and re-raises the signal after cleanup
    // so the default handler (or other listeners) can terminate the process.
    const cleanupHandler = async (signal: string) => {
      log.info("Shutting down guild MCP connections...");
      await guildMcpManager.cleanup();
      // Drain any buffered usage stats so a normal restart loses nothing
      // (plan §4 — graceful shutdown covers the documented crash window).
      await statRepository.shutdown();
      process.kill(process.pid, signal);
    };
    process.once("SIGINT", () => cleanupHandler("SIGINT"));
    process.once("SIGTERM", () => cleanupHandler("SIGTERM"));

    const runEnv = process.env.RUN_ENV || "development";
    if (runEnv !== "production") {
      try {
        const allEnabled = await toolRepository.loadAllEnabledMcpServers();
        if (allEnabled.length > 0) {
          log.info(`[GuildMCP] Dev mode: eager-connecting ${allEnabled.length} enabled guild MCP server(s)...`);
          // Non-blocking — failures are logged but don't prevent startup
          guildMcpManager.eagerConnectAll(allEnabled).catch((err) => {
            log.warn("[GuildMCP] Eager connect encountered errors (non-fatal)", err);
          });
        } else {
          log.info("[GuildMCP] No enabled guild MCP servers found for eager connect");
        }
      } catch (error) {
        log.warn("[GuildMCP] Failed to load guild MCP servers for eager connect (non-fatal)", error);
      }
    } else {
      log.info("[GuildMCP] Production mode: guild MCP connections will be established on-demand");
    }
  } catch (error) {
    const context: ErrorContext = {
      errorType: "MCPInitializationError",
      metadata: { stage: "startup" },
    };

    await log.error("Error during MCP server initialization:", error, context);

    // Don't throw the error - MCP failures shouldn't prevent bot startup
    // The bot can still function with built-in tools even if MCP servers fail
    log.info("Bot will continue startup despite MCP initialization failure");
  }
};
