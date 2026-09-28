/**
 * Manager-only moderation controls moved out of `/server` into `/moderation`. This gate lives outside
 * the implementation slice so command restrictions cannot be weakened with their assertion. The preset
 * tree's own restrictions are verified in `stPresetsRoutes.test.ts`.
 *
 * The former "/server still survives" and "seven absorbed keys are gone from /server" checks here
 * are gone: /server is listed in configRegistration.test.ts's DISSOLVED_ROOTS, which asserts it is
 * absent from both the execution map and the registration data.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { PermissionsBitField } from "discord.js";
import { loadCommandData, ROOT_COMMAND_EXECUTION_KEY } from "@/utils/discord/commandLoader";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

type RegistrationPayload = {
  name: string;
  contexts?: number[];
  default_member_permissions?: string;
};

function findRegistration(
  registrationData: Awaited<ReturnType<typeof loadCommandData>>["registrationData"],
  name: string,
): RegistrationPayload | undefined {
  return registrationData.find((command) => command.name === name) as unknown as RegistrationPayload | undefined;
}

describe("/moderation registration restrictions", () => {
  it("registers bare /moderation as guild-only and manager-only", async () => {
    const { executionMap, registrationData } = await loadCommandData();
    const moderation = findRegistration(registrationData, "moderation");

    expect(moderation).toBeDefined();
    if (!moderation) return;

    expect(moderation.contexts).toEqual([0]);
    expect(moderation.default_member_permissions).toBe(String(PermissionsBitField.Flags.ManageGuild));
    // Quotas and the member server-model policy are panel pages, not subcommands, so the root stays bare.
    expect([...(executionMap.get("moderation")?.keys() ?? [])]).toEqual([ROOT_COMMAND_EXECUTION_KEY]);
  });
});
