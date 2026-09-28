/**
 * `/bot respond` became the bare root `/respond`. `bot` sits in neither restriction list, so the
 * move must add no restriction, and the old leaf must be gone rather than coexisting.
 *
 * The relocated namespaces must resolve, asserting the returned string is not its own key path.
 * Only en-US is checked because `localizer` falls back to en-US per key, so any other locale passes
 * whenever en-US does. `/bot` itself is asserted gone by dissolvedBotRegistration.test.ts, and the
 * command description by commandDescriptionRegistration.test.ts.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { loadCommandData, ROOT_COMMAND_EXECUTION_KEY } from "@/utils/discord/commandLoader";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";

beforeAll(async () => {
  await initializeLocalizer();
}, 30000);

type RegistrationPayload = {
  name: string;
  description?: string;
  contexts?: number[];
  default_member_permissions?: string;
};

describe("/respond registration", () => {
  it("registers as an unrestricted bare root", async () => {
    const { registrationData, executionMap } = await loadCommandData();

    const respondCommand = registrationData.find((cmd) => cmd.name === "respond") as unknown as
      | RegistrationPayload
      | undefined;

    expect(respondCommand).toBeDefined();
    if (!respondCommand) return;

    expect(respondCommand.contexts).toBeUndefined();
    expect(respondCommand.default_member_permissions).toBeUndefined();
    expect(executionMap.get("respond")?.has(ROOT_COMMAND_EXECUTION_KEY)).toBe(true);
  }, 30000);

  it("resolves the relocated namespaces", () => {
    for (const key of [
      "general.errors.channel_missing_permissions_title",
      "commands.shared.persona_select.main_persona_description",
    ]) {
      const text = localizer("en-US", key);
      expect(text).not.toBe(key);
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
