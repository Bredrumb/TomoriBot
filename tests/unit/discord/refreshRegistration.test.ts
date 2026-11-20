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
    // Uses `hasLocaleKey` because `localizer` falls back to en-US while `embedProtocol` silently skips missing titles.
    expectForEveryLocale((locale) => {
      expect(hasLocaleKey(locale, "commands.refresh.title")).toBe(true);
      expect(localizer(locale, "commands.refresh.title").length).toBeGreaterThan(0);
    });
  });
});
