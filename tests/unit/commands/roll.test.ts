import { beforeAll, expect, it } from "bun:test";
import { type ChatInputCommandInteraction, type Client, type EmbedBuilder, MessageFlags } from "discord.js";
import { execute } from "@/commands/roll";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { localizedCopy } from "../../helpers/localeCases";

beforeAll(initializeLocalizer);

async function invoke(options: Record<string, string>) {
  const fixture = makeFakeInteraction();
  fixture.interaction.options.getString = (name) => options[name] ?? null;
  await execute({} as Client, fixture.interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");
  expect(fixture.calls.map((call) => call.method)).toEqual(["reply"]);
  return fixture.calls[0].args[0] as { embeds: EmbedBuilder[]; flags?: number; allowedMentions?: { parse: string[] } };
}

it("rolls without loading tool configuration and makes only Hidden ephemeral", async () => {
  for (const visibility of [undefined, "public", "hidden", "shared"]) {
    const reply = await invoke(visibility ? { dice: "3d4", visibility } : {});
    expect(reply.flags).toBe(visibility === "hidden" ? MessageFlags.Ephemeral : undefined);
    expect(reply.allowedMentions).toEqual({ parse: [] });
    const footerKey =
      visibility === "hidden"
        ? "commands.roll.footer_hidden"
        : visibility === "shared"
          ? "commands.roll.footer_shared"
          : "commands.roll.footer_public";
    expect(reply.embeds[0].data.footer?.text).toBe(localizedCopy("en-US", footerKey));
    expect(reply.embeds[0].data.description).toContain(visibility ? "3d4" : "1d20");
  }
});

it("rejects invalid expressions, modes, and visibility privately before rolling", async () => {
  for (const [options, errorKey] of [
    [{ dice: "2d6+1d4", visibility: "shared" }, "commands.roll.invalid_notation"],
    [{ dice: "101d6" }, "commands.roll.invalid_limits"],
    [{ dice: "3d4", mode: "advantage" }, "commands.roll.invalid_mode"],
    [{ dice: "d20", visibility: "unknown" }, "commands.roll.invalid_visibility"],
  ] as const) {
    const reply = await invoke(options);
    expect(reply.flags).toBe(MessageFlags.Ephemeral);
    expect(reply.embeds[0].data.description).toBe(localizedCopy("en-US", errorKey));
    expect(reply.embeds[0].data.footer).toBeUndefined();
  }
});
