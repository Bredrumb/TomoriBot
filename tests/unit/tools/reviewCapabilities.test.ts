import { describe, expect, it, spyOn } from "bun:test";
import { ApplicationCommandOptionType, type ApplicationCommandData, type Client } from "discord.js";
import { formatCommandCapabilities, ReviewCapabilitiesTool } from "@/tools/functionCalls/reviewCapabilities";
import { ToolRegistry } from "@/tools/toolRegistry";
import type { ToolContext } from "@/types/tool/interfaces";
import { rememberCustomProviderLabel } from "@/utils/provider/customProviderUtils";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { createRouteInteraction } from "../../helpers/routeInteraction";

it("reports a custom connection's saved label in capability reviews without supporter funding", async () => {
  const provider = "custom:9731";
  const label = "home-engine";
  rememberCustomProviderLabel(provider, label);
  const interaction = createRouteInteraction();
  const context: ToolContext = {
    channel: interaction.channel as unknown as ToolContext["channel"],
    client: interaction.client as Client,
    tomoriState: createPersona({ llm: createLlmRow({ llm_provider: provider }) }),
    locale: "en-US",
    provider: "custom",
  };
  const liveTools = spyOn(ToolRegistry, "getAvailableTools").mockReturnValue([]);
  const assembledTools = spyOn(ToolRegistry, "getAvailableToolsWithMCP").mockResolvedValue({
    builtInTools: [],
    mcpFunctionNames: [],
    totalCount: 0,
  });
  try {
    for (const capability_type of ["chat", "settings"]) {
      const result = await new ReviewCapabilitiesTool().execute({ capability_type }, context);
      expect(result.success).toBe(true);
      expect(result.message).toContain(label);
      expect(result.message).not.toContain(provider);
      if (capability_type === "chat") {
        expect(result.data).toMatchObject({ provider: expect.stringContaining(label) });
        expect(result.data).not.toMatchObject({ provider });
      }
    }
  } finally {
    liveTools.mockRestore();
    assembledTools.mockRestore();
  }
});

describe("review capabilities command catalog", () => {
  it("formats root, flat, and grouped commands from Discord registration data", () => {
    const registrationData = [
      {
        name: "update",
        description: "Update TomoriBot",
        options: [],
      },
      {
        name: "config",
        description: "Configure TomoriBot",
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "humanizer",
            description: "Configure humanizer behavior",
          },
          {
            type: ApplicationCommandOptionType.SubcommandGroup,
            name: "system-prompt",
            description: "Configure the system prompt",
            options: [
              {
                type: ApplicationCommandOptionType.Subcommand,
                name: "set",
                description: "Set the system prompt",
              },
              {
                type: ApplicationCommandOptionType.Subcommand,
                name: "remove",
                description: "Remove the system prompt",
              },
            ],
          },
        ],
      },
    ] as ApplicationCommandData[];

    const result = formatCommandCapabilities(registrationData);

    expect(result.markdown).toContain("**/update**");
    expect(result.markdown).toContain("**/config humanizer**");
    expect(result.markdown).toContain("**/config system-prompt set**");
    expect(result.markdown).toContain("**/config system-prompt remove**");
    expect(result.totalCommands).toBe(4);
    expect(result.totalCategories).toBe(2);
  });
});
