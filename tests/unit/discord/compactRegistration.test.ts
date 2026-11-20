import { beforeAll, describe, expect, it } from "bun:test";
import { SlashCommandBuilder } from "discord.js";
import * as compactCommand from "@/commands/compact";
import { loadCommandData } from "@/utils/discord/commandLoader";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

describe("/compact registration", () => {
  it("carries no contexts or default_member_permissions, and exports neither guildOnly nor managerOnly", () => {
    const data = compactCommand.configureCommand(new SlashCommandBuilder()).toJSON();
    expect(data.contexts).toBeUndefined();
    expect(data.default_member_permissions).toBeUndefined();
    expect((compactCommand as Record<string, unknown>).guildOnly).toBeUndefined();
    expect((compactCommand as Record<string, unknown>).managerOnly).toBeUndefined();
  });

  it("registers compact as a bare root through the real loader", async () => {
    const { registrationData } = await loadCommandData();
    const names = registrationData.map((command) => command.name);
    expect(names).toContain("compact");
  });

  it("removes the old /tool compact leaf", async () => {
    const { executionMap } = await loadCommandData();
    const toolSubcommands = executionMap.get("tool");
    expect(toolSubcommands).toBeDefined();
    expect(toolSubcommands?.has("compact")).toBe(false);
  });
});
