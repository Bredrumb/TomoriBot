import { beforeAll, describe, expect, it } from "bun:test";
import { loadCommandData } from "@/utils/discord/commandLoader";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

type RegistrationRestrictions = { default_member_permissions?: string };

describe("/tool and /generate root registration restrictions", () => {
  it("registers /tool with no contexts and no default_member_permissions", async () => {
    const { registrationData } = await loadCommandData();
    const tool = registrationData.find((command) => command.name === "tool");

    expect(tool).toBeDefined();
    expect(tool?.contexts).toBeUndefined();
    expect((tool as unknown as RegistrationRestrictions | undefined)?.default_member_permissions).toBeUndefined();
  }, 30000);

  it("registers /generate with no contexts and no default_member_permissions", async () => {
    const { registrationData } = await loadCommandData();
    const generate = registrationData.find((command) => command.name === "generate");

    expect(generate).toBeDefined();
    expect(generate?.contexts).toBeUndefined();
    expect((generate as unknown as RegistrationRestrictions | undefined)?.default_member_permissions).toBeUndefined();
  }, 30000);
});
