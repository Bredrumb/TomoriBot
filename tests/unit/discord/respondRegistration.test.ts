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
import { ApplicationCommandOptionType } from "discord.js";
import { loadCommandData, ROOT_COMMAND_EXECUTION_KEY } from "@/utils/discord/commandLoader";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";

beforeAll(async () => {
  await initializeLocalizer();
}, 30000);

type RegistrationPayload = {
  name: string;
  description?: string;
  contexts?: number[];
  default_member_permissions?: string;
  options?: Array<{
    name: string;
    type: number;
    description: string;
    required?: boolean;
    autocomplete?: boolean;
    max_length?: number;
  }>;
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

  it("registers direct optional parameters with persona autocomplete and bounded text", async () => {
    const { registrationData, autocompleteMap } = await loadCommandData();
    const command = registrationData.find((cmd) => cmd.name === "respond") as RegistrationPayload | undefined;
    expect(command?.options?.some((option) => option.name === "extra_options")).toBe(false);
    for (const [name, type] of [
      ["persona", ApplicationCommandOptionType.String],
      ["reasoning", ApplicationCommandOptionType.Boolean],
      ["prompt", ApplicationCommandOptionType.String],
      ["prefill", ApplicationCommandOptionType.String],
    ] as const) {
      const option = command?.options?.find((option) => option.name === name);
      expect(option).toBeDefined();
      expect(option?.type).toBe(type);
      expect(option?.required ?? false).toBe(false);
      expect(option?.description).toBe(localizedCopy("en-US", `commands.respond.${name}_description`));
      if (name === "persona") expect(option?.autocomplete).toBe(true);
      if (name === "prompt" || name === "prefill") expect(option?.max_length).toBe(2000);
    }
    expect(autocompleteMap.get("respond")?.has(ROOT_COMMAND_EXECUTION_KEY)).toBe(true);
  });

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
