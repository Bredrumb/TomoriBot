import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { configureSubcommand, execute } from "@/commands/personal/message-proxy";
import { PrivacyLevel, type UserRow } from "@/types/db/schema";
import { personalSettingsExportDataSchema } from "@/types/db/dataExport";
import { userRepository } from "@/utils/db/repositories";
import { initializeLocalizer } from "@/utils/text/localizer";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";

const originalSetter = userRepository.setMessageProxyService;

beforeAll(async () => {
  await initializeLocalizer();
});

afterEach(() => {
  userRepository.setMessageProxyService = originalSetter;
});

function user(service: string | null): UserRow {
  return {
    user_id: 42,
    user_disc_id: "user-42",
    user_nickname: "Mirri",
    language_pref: "en-US",
    registration_locale: "en-US",
    privacy_level: PrivacyLevel.MINIMAL,
    personal_memories: [],
    physical_appearance_tags: [],
    nai_char_ref_url: null,
    impersonation_prompt: null,
    shortterm_cache_crossserver_opt_in: false,
    personal_dtm: "follow",
    personal_deliberate_tool_mode: "follow",
    personal_server_fallback_enabled: true,
    timezone_offset: null,
    message_proxy_service: service,
  };
}

function interactionFor(service: string) {
  return makeFakeInteraction({
    options: {
      getString: () => service,
      getBoolean: () => null,
    },
  });
}

describe("/personal message-proxy", () => {
  it("builds the required registry-derived service choices", () => {
    const choices: Array<{ name: string; value: string }> = [];
    const option = {
      setName: () => option,
      setDescription: () => option,
      setRequired: () => option,
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

    expect(choices.map(({ value }) => value)).toEqual(["none", "pluralkit", "pluralbuddy"]);
  });

  it("defers before persisting a changed selection", async () => {
    const writes: Array<{ userId: number; serviceId: string | null }> = [];
    userRepository.setMessageProxyService = async (userId, serviceId) => {
      writes.push({ userId, serviceId });
      return true;
    };
    const { interaction, calls } = interactionFor("pluralkit");

    await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, user(null), "en-US");

    expect(calls[0]?.method).toBe("deferReply");
    expect(writes).toEqual([{ userId: 42, serviceId: "pluralkit" }]);
    const editReply = calls.find(({ method }) => method === "editReply");
    expect(JSON.stringify(editReply?.args)).toContain("in case PluralKit deletes and reposts it");
  });

  it("is idempotent when the requested selection is already stored", async () => {
    let writes = 0;
    userRepository.setMessageProxyService = async () => {
      writes += 1;
      return true;
    };
    const { interaction, calls } = interactionFor("none");

    await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, user("none"), "ja");

    expect(calls[0]?.method).toBe("deferReply");
    expect(writes).toBe(0);
    expect(calls.some(({ method }) => method === "editReply")).toBe(true);
  });

  it("accepts all storage states in the portable settings schema", () => {
    for (const serviceId of [null, "none", "pluralkit", "removed_service"] as const) {
      expect(
        personalSettingsExportDataSchema.safeParse({
          user_nickname: "Mirri",
          language_pref: "en-US",
          physical_appearance_tags: [],
          message_proxy_service: serviceId,
        }).success,
      ).toBe(true);
    }
  });
});
