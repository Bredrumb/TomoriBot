import { beforeAll, describe, expect, it } from "bun:test";
import { loadCommandData, ROOT_COMMAND_EXECUTION_KEY } from "@/utils/discord/commandLoader";
import { hasLocaleKey, initializeLocalizer, localizer } from "@/utils/text/localizer";
import { expectForEveryLocale } from "../../helpers/localeCases";

beforeAll(async () => initializeLocalizer());

type RegistrationPayload = {
  name: string;
  description?: string;
  contexts?: number[];
  default_member_permissions?: string;
};

describe("/refresh registration", () => {
  it("registers as an unrestricted bare root", async () => {
    const { registrationData, executionMap } = await loadCommandData();

    const refreshCommand = registrationData.find((cmd) => cmd.name === "refresh") as unknown as
      | RegistrationPayload
      | undefined;

    expect(refreshCommand).toBeDefined();
    if (!refreshCommand) return;

    expect(refreshCommand.contexts).toBeUndefined();
    expect(refreshCommand.default_member_permissions).toBeUndefined();
    expect(executionMap.get("refresh")?.has(ROOT_COMMAND_EXECUTION_KEY)).toBe(true);
  });

  it("removes the old /tool refresh leaf", async () => {
    const { executionMap } = await loadCommandData();

    const toolCommands = executionMap.get("tool");
    expect(toolCommands).toBeDefined();
    expect(toolCommands?.has("refresh")).toBe(false);
  });

  it("keeps the reset-marker title defined in every locale", () => {
    // `embedProtocol` builds its title table per locale and skips a missing key, so a locale without
    // this title silently stops recognizing its own reset embeds. `localizer` would fall back to
    // en-US and hide the gap, hence `hasLocaleKey`.
    expectForEveryLocale((locale) => {
      expect(hasLocaleKey(locale, "commands.refresh.title")).toBe(true);
      expect(localizer(locale, "commands.refresh.title").length).toBeGreaterThan(0);
    });
  });
});
