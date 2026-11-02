import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { configureSubcommand, execute } from "@/commands/personal/language";
import { userRepository } from "@/utils/db/repositories";
import { getLocaleEndonym, getSupportedLocales, initializeLocalizer } from "@/utils/text/localizer";
import { createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { localizedCopy } from "../../helpers/localeCases";

const originalSetter = userRepository.setLanguage;

beforeAll(async () => {
  await initializeLocalizer();
});

afterEach(() => {
  userRepository.setLanguage = originalSetter;
});

function interactionFor(language: string | null) {
  return makeFakeInteraction({
    options: {
      getString: (name: string) => (name === "language" ? language : null),
      getBoolean: () => null,
    },
  });
}

function recordWrites(store: string[]): void {
  userRepository.setLanguage = async (_userId, language) => {
    store.push(language);
    return true;
  };
}

describe("/personal language", () => {
  it("offers the authored locales as required choices", () => {
    const choices: Array<{ name: string; value: string }> = [];
    let required: boolean | undefined;

    const option = {
      setName: () => option,
      setDescription: () => option,
      setRequired: (value: boolean) => {
        required = value;
        return option;
      },
      addChoices: (...values: Array<{ name: string; value: string }>) => {
        choices.push(...values);
        return option;
      },
    };
    const subcommand = {
      setName: () => subcommand,
      setDescription: () => subcommand,
      addStringOption: (configure: (value: typeof option) => typeof option) => {
        configure(option);
        return subcommand;
      },
    };

    configureSubcommand(subcommand as never);

    expect(required).toBe(true);
    expect(choices.map(({ value }) => value)).toEqual(getSupportedLocales());
    expect(choices.find(({ value }) => value === "ja")?.name).toBe(getLocaleEndonym("ja"));
  });

  it("writes the picked language and confirms in it", async () => {
    const writes: string[] = [];
    recordWrites(writes);
    const { interaction, calls } = interactionFor("ja");

    await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");

    expect(calls[0]?.method).toBe("deferReply");
    expect(writes).toEqual(["ja"]);
    const editReply = calls.find(({ method }) => method === "editReply");
    expect(JSON.stringify(editReply?.args)).toContain(
      localizedCopy("ja", "commands.personal.config.language_updated_detail", { language: getLocaleEndonym("ja") }),
    );
  });

  it("refuses a value outside the authored locales without writing", async () => {
    const writes: string[] = [];
    recordWrites(writes);
    const { interaction, calls } = interactionFor("de");

    await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");

    expect(writes).toEqual([]);
    expect(calls.map(({ method }) => method)).not.toContain("deferReply");
    const reply = calls.find(({ method }) => method === "reply");
    expect(JSON.stringify(reply?.args)).toContain(localizedCopy("en-US", "general.errors.invalid_option_description"));
  });

  it("reports a failed write in the caller's language", async () => {
    userRepository.setLanguage = async () => false;
    const { interaction, calls } = interactionFor("ja");

    await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "ja");

    const editReply = calls.find(({ method }) => method === "editReply");
    expect(JSON.stringify(editReply?.args)).toContain(localizedCopy("ja", "general.errors.update_failed_description"));
  });
});
