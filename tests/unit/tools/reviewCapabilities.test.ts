import { describe, expect, it } from "bun:test";
import { ApplicationCommandOptionType, type ApplicationCommandData } from "discord.js";
import { formatCommandCapabilities } from "@/tools/functionCalls/reviewCapabilities";

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
