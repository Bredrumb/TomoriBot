import path from "node:path";
import { log } from "../utils/misc/logger";
import { ToolRegistry } from "./toolRegistry";
import getAllFiles from "../utils/misc/ioHelper";
import { BaseTool } from "../types/tool/interfaces";
import type { ErrorContext } from "../types/db/schema";

export async function initializeTools(): Promise<void> {
  try {
    log.info("Initializing tool registry with auto-discovery...");

    ToolRegistry.clearRegistry();

    let totalDiscovered = 0;

    const functionCallsPath = path.join(process.cwd(), "src", "tools", "functionCalls");
    const functionCallFiles = (await getAllFiles(functionCallsPath)).filter((file) => !file.endsWith("index.ts"));

    log.info(`Scanning ${functionCallFiles.length} files in functionCalls directory...`);

    for (const toolFile of functionCallFiles) {
      const discovered = await discoverAndRegisterTools(toolFile, "functionCalls");
      totalDiscovered += discovered;
    }

    // Scan only webSearchTool.ts so internal engine modules are not registered as LLM-visible tools.
    const webSearchPath = path.join(process.cwd(), "src", "tools", "webSearch");
    const webSearchFiles = (await getAllFiles(webSearchPath)).filter((file) => file.endsWith("webSearchTool.ts"));

    log.info(`Scanning ${webSearchFiles.length} files in webSearch directory...`);

    for (const wsFile of webSearchFiles) {
      const discovered = await discoverAndRegisterTools(wsFile, "webSearch");
      totalDiscovered += discovered;
    }

    // Scan only fetchUrlTool.ts so internal fetch engine modules stay excluded from tool registration.
    const fetchUrlPath = path.join(process.cwd(), "src", "tools", "fetchUrl");
    const fetchUrlFiles = (await getAllFiles(fetchUrlPath)).filter((file) => file.endsWith("fetchUrlTool.ts"));

    log.info(`Scanning ${fetchUrlFiles.length} files in fetchUrl directory...`);

    for (const fetchUrlFile of fetchUrlFiles) {
      const discovered = await discoverAndRegisterTools(fetchUrlFile, "fetchUrl");
      totalDiscovered += discovered;
    }

    const stats = ToolRegistry.getStats();
    log.success(
      `Auto-discovery complete: Found and registered ${totalDiscovered} tools (${stats.totalTools} total in registry)`,
    );
    log.info(
      `Tools by category: ${Object.entries(stats.toolsByCategory)
        .map(([cat, count]) => `${cat}=${count}`)
        .join(", ")}`,
    );
  } catch (error) {
    log.error("Failed to initialize tool registry", error as Error);
    throw error;
  }
}

async function discoverAndRegisterTools(filePath: string, source: string): Promise<number> {
  let discoveredCount = 0;

  try {
    const toolModule = await import(filePath);

    for (const [exportName, exportedItem] of Object.entries(toolModule)) {
      try {
        if (typeof exportedItem === "function" && exportedItem.prototype instanceof BaseTool) {
          const toolInstance = new (exportedItem as new () => BaseTool)();

          ToolRegistry.registerTool(toolInstance);

          log.info(`Auto-registered [${source}]: ${toolInstance.name} (${toolInstance.category}) from ${exportName}`);

          discoveredCount++;
        }
      } catch (error) {
        const context: ErrorContext = {
          errorType: "ToolRegistrationError",
          metadata: {
            filePath,
            exportName,
            source,
          },
        };
        await log.error(`Failed to register tool export '${exportName}' from ${filePath}:`, error as Error, context);
      }
    }
  } catch (error) {
    const context: ErrorContext = {
      errorType: "ToolDiscoveryError",
      metadata: {
        filePath,
        source,
      },
    };
    await log.error(`Failed to import tool file: ${filePath}`, error as Error, context);
  }

  return discoveredCount;
}
