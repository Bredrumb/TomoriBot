import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { isDraining } from "@/utils/misc/shutdownState";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { log } from "@/utils/misc/logger";
import type { ErrorContext } from "@/types/db/schema";
import { getShardTopology } from "@/utils/discord/shardOwnership";
import { hasShardLeaseOwnership } from "@/utils/cluster/shardLeases";

export default async (): Promise<void> => {
  if (isDraining() || !hasShardLeaseOwnership()) return;
  try {
    log.section("Preparing guild MCP connections");

    const guildMcpManager = getGuildMcpManager();

    const runEnv = process.env.RUN_ENV || "development";
    if (runEnv !== "production") {
      try {
        const allEnabled = await toolRepository.loadAllEnabledMcpServers(getShardTopology());
        if (isDraining() || !hasShardLeaseOwnership()) return;
        if (allEnabled.length > 0) {
          log.info(`[GuildMCP] Dev mode: eager-connecting ${allEnabled.length} enabled guild MCP server(s)...`);
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

    await log.error("Error during guild MCP startup:", error, context);

    log.info("Bot will continue startup despite guild MCP startup failure");
  }
};
