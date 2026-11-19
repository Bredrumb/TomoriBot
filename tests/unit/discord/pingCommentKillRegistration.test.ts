import { beforeAll, describe, expect, it } from "bun:test";
import { SlashCommandBuilder } from "discord.js";
import * as commentCommand from "@/commands/comment";
import * as killCommand from "@/commands/kill";
import * as pingCommand from "@/commands/ping";
import { loadCommandData } from "@/utils/discord/commandLoader";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

describe("/ping, /comment, /kill registration", () => {
  it("carries no contexts or default_member_permissions, and exports neither guildOnly nor managerOnly", () => {
    for (const module of [pingCommand, commentCommand, killCommand] as const) {
      const data = module.configureCommand(new SlashCommandBuilder()).toJSON();
      expect(data.contexts).toBeUndefined();
      expect(data.default_member_permissions).toBeUndefined();
      expect((module as Record<string, unknown>).guildOnly).toBeUndefined();
      expect((module as Record<string, unknown>).managerOnly).toBeUndefined();
    }
  });

  it("registers ping, comment, and kill as bare roots through the real loader", async () => {
    const { registrationData } = await loadCommandData();
    const names = registrationData.map((command) => command.name);
    expect(names).toContain("ping");
    expect(names).toContain("comment");
    expect(names).toContain("kill");
  });

  it("removes the old /tool ping and /tool comment leaves", async () => {
    const { executionMap } = await loadCommandData();
    const toolSubcommands = executionMap.get("tool");
    expect(toolSubcommands).toBeDefined();
    expect(toolSubcommands?.has("ping")).toBe(false);
    expect(toolSubcommands?.has("comment")).toBe(false);
  });
});
