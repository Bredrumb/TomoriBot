import { beforeAll, describe, expect, it } from "bun:test";
import type { ApplicationCommandData } from "discord.js";
import { loadCommandData } from "@/utils/discord/commandLoader";
import { initializeLocalizer } from "@/utils/text/localizer";
import { ApplicationCommandOptionType } from "discord.js";

beforeAll(async () => initializeLocalizer());

/**
 * The raw payload the command builders serialize onto the wire: snake_case at the root, and an
 * option tree that nests one level deeper than the builder-facing union exposes.
 */
type CommandPayload = {
  contexts?: number[];
  default_member_permissions?: string;
  options?: CommandOption[];
};

type CommandOption = {
  name?: string;
  type?: number;
  autocomplete?: boolean;
  options?: CommandOption[];
};

function findRoot(registrationData: ApplicationCommandData[], name: string): CommandPayload | undefined {
  return registrationData.find((command) => command.name === name) as unknown as CommandPayload | undefined;
}

describe("/impersonate root registration", () => {
  it("registers /impersonate as a guild-only bare root", async () => {
    const { registrationData } = await loadCommandData();
    const impersonate = findRoot(registrationData, "impersonate");

    expect(impersonate).toBeDefined();
    expect(impersonate?.contexts).toEqual([0]);
    expect(impersonate?.default_member_permissions).toBeUndefined();
  }, 30000);

  it("makes the autocomplete handler reachable under the lookup key", async () => {
    const { autocompleteMap } = await loadCommandData();
    const impersonateAutocomplete = autocompleteMap.get("impersonate")?.get("persona");

    expect(impersonateAutocomplete).toBeDefined();
    expect(typeof impersonateAutocomplete).toBe("function");
  }, 30000);

  it("configures the subcommands and option types", async () => {
    const { registrationData } = await loadCommandData();
    const impersonate = findRoot(registrationData, "impersonate");

    const persona = impersonate?.options?.find((o) => o.name === "persona");
    const user = impersonate?.options?.find((o) => o.name === "user");
    const system = impersonate?.options?.find((o) => o.name === "system");

    expect(persona).toBeDefined();
    expect(user).toBeDefined();
    expect(system).toBeDefined();

    const personaOption = persona?.options?.find((o) => o.name === "persona");
    expect(personaOption).toBeDefined();
    expect(personaOption?.autocomplete).toBe(true);

    const userOption = user?.options?.find((o) => o.name === "user");
    expect(userOption).toBeDefined();
    expect(userOption?.type).toBe(ApplicationCommandOptionType.User);

    // /impersonate user takes ONLY the target. The bot generates the message itself via
    // tomoriChat(isUserImpersonation), so a `message` option here would be a field the user
    // must fill and the command then discards.
    expect(user?.options?.length).toBe(1);
    expect(user?.options?.some((option) => option.name === "message")).toBe(false);

    const systemPromptOption = system?.options?.find((o) => o.name === "prompt");
    expect(systemPromptOption).toBeDefined();
    // biome-ignore lint/suspicious/noExplicitAny: API types use max_length but Discord.js typings use maxLength which is lost in toJSON
    expect((systemPromptOption as any)?.max_length).toBe(2000);
  }, 30000);
});
