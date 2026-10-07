import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { type CallableTool, Type } from "@google/genai";
import { ToolRegistry } from "@/tools/toolRegistry";
import type { ToolContext } from "@/types/tool/interfaces";
import type { GuildMCPConnection } from "@/types/tool/mcpTypes";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { getMCPManager } from "@/utils/mcp/mcpManager";
import { getMCPExecutor } from "@/utils/mcp/mcpExecutor";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createPersona } from "../../helpers/fixtures";
import { stubLogMembers } from "../../helpers/mockSurface";

stubLogMembers({ error: async () => {}, warn: () => {}, info: () => {}, success: () => {} });

describe("reviewed requests at real dispatch owners", () => {
  let cancelled = false;
  let effects: Array<{ name: string; args: Record<string, unknown> }>;
  let context: ToolContext;
  const guild = getGuildMcpManager();
  const global = getMCPManager();
  const executor = getMCPExecutor();
  const guildRoute = spyOn(guild, "isGuildMCPFunction");
  const ready = spyOn(global, "isReady");
  const globalTools = spyOn(global, "getMCPTools");
  const finder = spyOn(
    guild as unknown as {
      findConnectionForFunction(serverId: number, name: string): Promise<GuildMCPConnection | null>;
    },
    "findConnectionForFunction",
  );

  beforeEach(() => {
    cancelled = false;
    effects = [];
    ToolRegistry.clearRegistry();
    context = {
      channel: { id: "fixture-channel" } as ToolContext["channel"],
      client: {} as ToolContext["client"],
      tomoriState: createPersona(),
      locale: "en-US",
      provider: "review-fixture",
      suppressProgressNotices: true,
      messageIdMap: new MessageIdMap(),
      isExecutionCancelled: () => cancelled,
    };
    guildRoute.mockResolvedValue(false);
    finder.mockResolvedValue(null);
    ready.mockReturnValue(true);
    globalTools.mockReturnValue([]);
    ToolRegistry.registerMCPAdapter({
      getProviderName: () => context.provider,
      convertTool: () => ({}),
      convertResult: () => ({}),
      getAllToolsInProviderFormat: async () => [],
      isMCPFunction: (name) => executor.isMCPFunction(name),
      executeMCPFunction: (name, args, toolContext) => executor.executeMCPFunction(name, args, toolContext),
    });
  });

  afterEach(() => {
    ToolRegistry.clearRegistry();
  });
  afterAll(() => {
    for (const spy of [guildRoute, ready, globalTools, finder]) spy.mockRestore();
  });

  // These spies replace discovery only. The registry and MCP executors invoke real fake transports.
  const transport = (name: string, interruptOnDiscovery = false): CallableTool => ({
    tool: async () => {
      if (interruptOnDiscovery) cancelled = true;
      return { functionDeclarations: [{ name, parameters: { type: Type.OBJECT, properties: {} } }] };
    },
    callTool: async (calls) => {
      for (const call of calls) effects.push({ name: call.name ?? "", args: call.args ?? {} });
      return [{ functionResponse: { name, response: { completed: true } } }];
    },
  });

  it("prevents author dispatch of the configured internal checker", async () => {
    context.tomoriState.config.response_rule_checker_ref = {
      scope: "global",
      serviceName: "fixture-checker",
      toolName: "check_slop",
    };
    globalTools.mockReturnValue([transport("check_slop")]);
    expect((await ToolRegistry.executeTool("check_slop", { text: "PRIVATE_DRAFT" }, context)).success).toBe(false);
    expect(effects).toHaveLength(0);
  });

  it("fixes aliases and opaque targets before review and retains execution-time availability", async () => {
    ToolRegistry.registerTool({
      name: "create_long_term_memory",
      description: "Harmless memory fixture",
      category: "memory",
      parameters: { type: "object", properties: {}, required: [] },
      isAvailableFor: () => true,
      isAvailableForContext: () => context.guildId === "allowed",
      execute: async (args) => {
        effects.push({ name: "create_long_term_memory", args });
        return { success: true };
      },
    });
    const opaque = context.messageIdMap?.register("900000000000000001", "ref");
    const prepared = await ToolRegistry.prepareToolRequest("remember_this_fact", { message_id: opaque }, context);
    context.preparedToolRequest = prepared;
    expect(prepared).toEqual({
      name: "create_long_term_memory",
      args: { message_id: "900000000000000001", __original_message_id: opaque },
    });
    expect((await ToolRegistry.executeTool(prepared.name, prepared.args, context)).success).toBe(false);
    expect(effects).toEqual([]);
    context.guildId = "allowed";
    expect((await ToolRegistry.executeTool(prepared.name, prepared.args, context)).success).toBe(true);
    expect(effects).toEqual([prepared]);
  });

  it("global MCP sends the prepared defaults exactly once through its existing executor", async () => {
    globalTools.mockReturnValue([transport("brave_web_search")]);
    const prepared = await ToolRegistry.prepareToolRequest(
      "brave_web_search",
      { query: "fictional fixture", count: 1 },
      context,
    );
    expect(prepared.args).toMatchObject({ count: 20, summary: true, safesearch: "off" });
    context.preparedToolRequest = prepared;
    expect((await ToolRegistry.executeTool(prepared.name, prepared.args, context)).success).toBe(true);
    expect(effects).toEqual([prepared]);
  });

  it("global MCP cancels after asynchronous discovery before calling the transport", async () => {
    globalTools.mockReturnValue([transport("fixture_lookup", true)]);
    expect((await ToolRegistry.executeTool("fixture_lookup", { target: "fixture" }, context)).success).toBe(false);
    expect(effects).toEqual([]);
  });

  for (const cancelAfterLookup of [false, true]) {
    it(`workspace MCP ${cancelAfterLookup ? "cancels after" : "executes after"} asynchronous connection lookup`, async () => {
      guildRoute.mockResolvedValue(true);
      finder.mockImplementation(async () => {
        cancelled = cancelAfterLookup;
        return {
          guildMcpId: 91,
          serverId: context.tomoriState.server_id,
          name: "fixture",
          client: {},
          callableTool: transport("fixture_lookup"),
          functionNames: ["fixture_lookup"],
          connectedAt: 0,
          lastUsedAt: 0,
        };
      });
      const request = { name: "fixture_lookup", args: { target: "fixture", text: "Quiet note" } };
      context.preparedToolRequest = request;
      expect((await ToolRegistry.executeTool(request.name, request.args, context)).success).toBe(!cancelAfterLookup);
      expect(effects).toEqual(cancelAfterLookup ? [] : [request]);
    });
  }

  it("registry cancellation after route lookup blocks a built-in effect", async () => {
    ToolRegistry.registerTool({
      name: "fixture_action",
      description: "Harmless action",
      category: "utility",
      parameters: { type: "object", properties: {}, required: [] },
      isAvailableFor: () => true,
      execute: async (args) => {
        effects.push({ name: "fixture_action", args });
        return { success: true };
      },
    });
    guildRoute.mockImplementation(async () => {
      cancelled = true;
      return false;
    });
    expect((await ToolRegistry.executeTool("fixture_action", {}, context)).success).toBe(false);
    expect(effects).toEqual([]);
  });
});
