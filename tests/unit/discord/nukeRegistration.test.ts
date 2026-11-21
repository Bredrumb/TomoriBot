/**
 * `/server nuke` becomes the bare root `/nuke`. Since `server` restricts to guilds and requires
 * ManageGuild, `/nuke` must manually assert both restrictions.
 *
 * The former "/server still exists and doesn't have a nuke subcommand" checks here are gone: /server is
 * listed in configRegistration.test.ts's DISSOLVED_ROOTS, which asserts it is absent from both the
 * execution map and the registration data.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { loadCommandData, ROOT_COMMAND_EXECUTION_KEY } from "@/utils/discord/commandLoader";
import { resolveCommandCooldown } from "@/events/interactionCreate/handleCommands";
import { initializeLocalizer } from "@/utils/text/localizer";
import { PermissionsBitField } from "discord.js";

beforeAll(async () => initializeLocalizer());

type RegistrationPayload = {
  name: string;
  description?: string;
  contexts?: number[];
  default_member_permissions?: string;
};

describe("/nuke registration", () => {
  it("registers as a restricted bare root", async () => {
    const { registrationData, executionMap } = await loadCommandData();

    const nukeCommand = registrationData.find((cmd) => cmd.name === "nuke") as unknown as
      | RegistrationPayload
      | undefined;

    expect(nukeCommand).toBeDefined();
    if (!nukeCommand) return;

    expect(nukeCommand.contexts).toEqual([0]); // InteractionContextType.Guild only, never a DM context
    expect(nukeCommand.default_member_permissions).toBe(String(PermissionsBitField.Flags.ManageGuild));
    expect(executionMap.get("nuke")?.has(ROOT_COMMAND_EXECUTION_KEY)).toBe(true);
  });

  it("applies the correct cooldown to the new bare root", () => {
    const serverCooldown = 3000;
    const defaultCooldown = 1600;

    expect(resolveCommandCooldown("nuke")).toBe(serverCooldown);
    expect(resolveCommandCooldown("server")).toBe(serverCooldown);

    // Anchors the two assertions above: without it they still pass when both entries fall through.
    expect(resolveCommandCooldown("unknown-command")).toBe(defaultCooldown);
  });
});
