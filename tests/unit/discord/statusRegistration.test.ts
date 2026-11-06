import { beforeAll, describe, expect, it } from "bun:test";
import { ApplicationCommandOptionType } from "discord.js";
import { loadCommandData } from "@/utils/discord/commandLoader";
import { localizer, initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

type RegistrationPayload = {
  name: string;
  description_localizations?: Record<string, string>;
  contexts?: number[];
  default_member_permissions?: string;
  options?: unknown[];
};

describe("/status registration", () => {
  it("registers a bare root with only optional jump options and no restrictions", async () => {
    const { registrationData } = await loadCommandData();
    const status = registrationData.find((command) => command.name === "status") as unknown as
      | RegistrationPayload
      | undefined;

    expect(status).toBeDefined();
    if (!status) return;

    expect(status.contexts).toBeUndefined();
    expect(status.default_member_permissions).toBeUndefined();
    expect(status.options).toEqual([
      expect.objectContaining({ name: "page", type: ApplicationCommandOptionType.String, autocomplete: true }),
      expect.objectContaining({ name: "persona", type: ApplicationCommandOptionType.String, autocomplete: true }),
    ]);
    for (const option of status.options ?? []) {
      expect((option as { required?: boolean }).required ?? false).toBe(false);
    }
    expect(status.description_localizations?.ja).toBe(localizer("ja", "commands.status.description"));
  }, 30000);
});
