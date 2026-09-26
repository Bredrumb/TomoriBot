/**
 * Registration coverage for the direct move of /tool compact to /compact.
 * Tool sits in neither GUILD_ONLY_CATEGORIES nor MANAGER_ONLY_CATEGORIES (commandLoader.ts),
 * so /compact carried no restriction before the move and must carry none after it.
 * This test asserts through the real loadCommandData() that /compact is registered as an
 * unrestricted bare root and the old /tool compact leaf is removed. The members /tool keeps are
 * asserted by configRegistration.test.ts's RETAINED_KEYS_BY_ROOT.
 */
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
