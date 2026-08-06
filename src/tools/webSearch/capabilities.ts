import { isBraveSearchAvailable } from "@/tools/restAPIs/brave/braveSearchService";
import { isSearxngAvailable } from "@/tools/restAPIs/searxng/searxngService";
import { getMCPManager } from "@/utils/mcp/mcpManager";
import { log } from "@/utils/misc/logger";
import { BASE_SEARCH_CATEGORIES, SEARCH_CATEGORIES, type SearchCategory, type WebSearchEngineName } from "./types";

export interface WebSearchToolCapabilities {
  categories: SearchCategory[];
  engineLabel: string;
}

async function hasMcpSearchFunction(functionName: "web-search" | "iask-search"): Promise<boolean> {
  const mcpManager = getMCPManager();
  if (!mcpManager.isReady()) {
    return false;
  }

  try {
    const mcpTools = mcpManager.getMCPTools();
    for (const mcpTool of mcpTools) {
      const geminiTool = await mcpTool.tool();
      if (geminiTool.functionDeclarations?.some((declaration) => declaration.name === functionName)) {
        return true;
      }
    }
  } catch (error) {
    log.warn(`Web search MCP capability probe failed for ${functionName}`, error as Error);
  }

  return false;
}

function describeEngine(engineName: WebSearchEngineName): string {
  switch (engineName) {
    case "brave":
      return "Brave Search";
    case "searxng":
      return "SearXNG";
    case "duckduckgo":
      return "DuckDuckGo MCP";
    case "iask":
      return "IAsk MCP";
  }
}

export async function resolveWebSearchToolCapabilities(serverId?: number): Promise<WebSearchToolCapabilities | null> {
  const searxngAvailable = await isSearxngAvailable();
  const braveAvailable = await isBraveSearchAvailable(serverId);

  if (searxngAvailable) {
    return {
      categories: [...SEARCH_CATEGORIES],
      engineLabel: braveAvailable
        ? `${describeEngine("brave")} + ${describeEngine("searxng")}`
        : describeEngine("searxng"),
    };
  }

  if (braveAvailable) {
    return {
      categories: [...BASE_SEARCH_CATEGORIES],
      engineLabel: describeEngine("brave"),
    };
  }

  if (await hasMcpSearchFunction("web-search")) {
    return {
      categories: ["text"],
      engineLabel: describeEngine("duckduckgo"),
    };
  }

  if (await hasMcpSearchFunction("iask-search")) {
    return {
      categories: ["text"],
      engineLabel: describeEngine("iask"),
    };
  }

  return null;
}
