import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { PermissionFlagsBits, PermissionsBitField, type Client, type Message } from "discord.js";
import { ReviewCapabilitiesTool } from "@/tools/functionCalls/reviewCapabilities";
import { ToolRegistry } from "@/tools/toolRegistry";
import type { ToolContext } from "@/types/tool/interfaces";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createGuildTextChannel } from "../../helpers/discordChannels";
import { createPersona } from "../../helpers/fixtures";

const restores: Array<() => void> = [];
beforeAll(initializeLocalizer);
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
});

function member(id: string, permissions: bigint) {
  return { id, permissions: new PermissionsBitField(permissions) };
}

function settingsContext(overrides: Partial<ToolContext>, guildMembers: Record<string, bigint> = {}): ToolContext {
  const available = spyOn(ToolRegistry, "getAvailableTools").mockReturnValue([]);
  const assembled = spyOn(ToolRegistry, "getAvailableToolsWithMCP").mockResolvedValue({
    builtInTools: [],
    mcpFunctionNames: [],
  } as never);
  restores.push(
    () => available.mockRestore(),
    () => assembled.mockRestore(),
  );
  const guild = {
    members: {
      fetch: async (id: string) => {
        const permissions = guildMembers[id];
        if (permissions === undefined) throw new Error("Unknown Member");
        return member(id, permissions);
      },
    },
  };
  return {
    channel: createGuildTextChannel("source-channel", { guildId: "guild" }),
    client: { user: { id: "bot" }, guilds: { fetch: async () => guild } } as unknown as Client,
    guildId: "guild",
    locale: "en-US",
    provider: "google",
    tomoriState: createPersona({ config: { system_prompt: "synthetic" } }),
    ...overrides,
  };
}

function anchoredOn(authorId: string, permissions: bigint): Message {
  return { id: `anchor-${authorId}`, member: member(authorId, permissions) } as unknown as Message;
}

async function operationalDetailsVisible(context: ToolContext): Promise<boolean> {
  const result = await new ReviewCapabilitiesTool().execute({ capability_type: "settings" }, context);
  expect(result.success).toBe(true);
  return (result.data as { operational_details_visible: boolean }).operational_details_visible;
}

describe("review capabilities settings operational details", () => {
  it("redacts a borrowed turn anchored on the bot's own message", async () => {
    const context = settingsContext({
      userId: "member",
      borrowsTriggerMessage: true,
      message: anchoredOn("bot", PermissionFlagsBits.ManageGuild),
    });
    expect(await operationalDetailsVisible(context)).toBe(false);
  });

  it("redacts a non-manager whose turn carries an unrelated manager's message", async () => {
    const context = settingsContext(
      { userId: "member", message: anchoredOn("manager", PermissionFlagsBits.ManageGuild) },
      { member: PermissionFlagsBits.SendMessages },
    );
    expect(await operationalDetailsVisible(context)).toBe(false);
  });

  it("redacts when the requester cannot be resolved", async () => {
    const context = settingsContext({
      userId: "member",
      message: anchoredOn("manager", PermissionFlagsBits.ManageGuild),
    });
    expect(await operationalDetailsVisible(context)).toBe(false);
  });

  it("shows operational details to a manager on their own message", async () => {
    const context = settingsContext({
      userId: "manager",
      message: anchoredOn("manager", PermissionFlagsBits.ManageGuild),
    });
    expect(await operationalDetailsVisible(context)).toBe(true);
  });

  it("shows operational details to a manager responding to another member's message", async () => {
    const context = settingsContext(
      { userId: "manager", message: anchoredOn("member", PermissionFlagsBits.SendMessages) },
      { manager: PermissionFlagsBits.ManageGuild },
    );
    expect(await operationalDetailsVisible(context)).toBe(true);
  });
});
