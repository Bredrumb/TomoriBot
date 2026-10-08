import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { getAvailableToolsWithMCP, type ToolStateForContext } from "@/tools/availability";
import type { GuildMcpServerRow } from "@/types/db/schema";
import type { Tool } from "@/types/tool/interfaces";
import * as guildMcpConfigCache from "@/utils/cache/guildMcpConfigCache";
import * as dbClient from "@/utils/db/client";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import * as speechEndpointResolver from "@/utils/provider/speechEndpointResolver";
import * as crypto from "@/utils/security/crypto";
import { createPersona } from "../../helpers/fixtures";
import { stubLogMembers } from "../../helpers/mockSurface";

stubLogMembers({ warn: () => {}, info: () => {} });

function builtIn(name: string): Tool {
  return {
    name,
    description: `${name} fixture`,
    category: "search",
    parameters: { type: "object", properties: {}, required: [] },
    isAvailableFor: () => true,
    execute: async () => ({ success: true }),
  };
}

const BUILT_INS = ["web_search", "fetch_url", "manage_message"].map(builtIn);

function stateForContext(): ToolStateForContext {
  const persona = createPersona();
  return {
    server_id: String(persona.server_id),
    activePersonaHasElevenlabsVoice: false,
    llm: persona.llm,
    config: persona.config,
  };
}

function guildServer(name: string, serverType: string | null): GuildMcpServerRow {
  return {
    guild_mcp_id: 1,
    server_id: 1,
    name,
    url: `https://${name}.example/mcp`,
    key_version: 1,
    is_enabled: true,
    server_type: serverType,
  };
}

describe("guild MCP replacement availability without a bundled MCP manager", () => {
  const guild = getGuildMcpManager();
  const allNames = spyOn(guild, "getGuildMCPFunctionNames");
  const namesByType = spyOn(guild, "getGuildMCPFunctionNamesByServerType");
  const enabledConfigs = spyOn(guildMcpConfigCache, "getCachedEnabledGuildMcpConfigs");
  // Backend-slot lookups only gate media tools, which this suite does not register.
  const slots = spyOn(dbClient, "sql").mockImplementation((async () => []) as unknown as typeof dbClient.sql);
  const speech = spyOn(speechEndpointResolver, "resolveActiveSpeechEndpoint").mockResolvedValue(null);
  const optKey = spyOn(crypto, "hasOptApiKey").mockResolvedValue(false);

  beforeEach(() => {
    allNames.mockResolvedValue([]);
    namesByType.mockResolvedValue([]);
    enabledConfigs.mockResolvedValue([]);
  });

  afterAll(() => {
    for (const spy of [allNames, namesByType, enabledConfigs, slots, speech, optKey]) spy.mockRestore();
  });

  it("keeps native search and fetch when the guild selects no replacement", async () => {
    const result = await getAvailableToolsWithMCP(BUILT_INS, "google", stateForContext());

    expect(result.builtInTools.map((tool) => tool.name)).toEqual(["web_search", "fetch_url", "manage_message"]);
    expect(result.mcpFunctionNames).toEqual([]);
  });

  it("advertises a selected url_fetcher in place of fetch_url and hides colliding names", async () => {
    allNames.mockResolvedValue(["fetch", "manage_message", "lookup_notes"]);
    namesByType.mockImplementation(async (_serverId, serverType) => (serverType === "url_fetcher" ? ["fetch"] : []));
    enabledConfigs.mockResolvedValue([guildServer("reader", "url_fetcher"), guildServer("notes", null)]);

    const result = await getAvailableToolsWithMCP(BUILT_INS, "google", stateForContext());

    expect(result.builtInTools.map((tool) => tool.name)).toEqual(["web_search", "manage_message"]);
    expect(result.mcpFunctionNames).toEqual(["fetch", "lookup_notes"]);
  });
});
