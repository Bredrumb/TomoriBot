/**
 * Autocomplete is an optimization, never authorization: Discord submits whatever the user typed,
 * not only what was suggested. These tests pin the execute-side contract that an omitted option
 * resolves through the shared fallback chain, while a value that does not resolve to a persona the
 * actor may currently trigger is rejected before any repository write.
 */
import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import {
  Collection,
  escapeMarkdown,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type EmbedBuilder,
} from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { personaRepository } from "@/utils/db/repositories";
import { conditioningMemoryRepository } from "@/utils/db/repositories/ConditioningMemoryRepository";
import * as whitelistCache from "@/utils/cache/channelWhitelistCache";
import * as spotlightCache from "@/utils/cache/personalSpotlightCache";
import * as tomoriChatModule from "@/events/messageCreate/tomoriChat";
import { createConditioningInteractionCommand } from "@/utils/conditioning/conditioningInteractionCommand";
import { initializeLocalizer } from "@/utils/text/localizer";
import { execute as executeFeed } from "@/commands/reward/feed";
import { createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { collectCaseFailures, localizedCopy, RUNTIME_LOCALES } from "../../helpers/localeCases";
import { CONDITIONING_ACTION_LOCALE_KEYS, type ConditioningActionKey } from "@/utils/conditioning/conditioning";
import { CONDITIONING_ACTION_TYPES } from "@/utils/conditioning/conditioning";
import { buildConditioningInteractionEmbed } from "@/utils/conditioning/conditioningEmbed";
import { classifyProtocolTitle } from "@/utils/discord/embedProtocol";

beforeAll(async () => initializeLocalizer());

function createPersona(personaId: number, lineageId: number, nickname: string, isAlter: boolean): TomoriState {
  return {
    persona_id: personaId,
    persona_lineage_id: lineageId,
    persona_nickname: nickname,
    is_alter: isAlter,
    server_id: 7,
    config: { autoch_disc_ids: [], autoch_persona_overrides: [], message_fetch_limit: 80 },
  } as unknown as TomoriState;
}

const MAIN = createPersona(1, 101, "Main", false);
const ALTER = createPersona(2, 102, "Alter", true);
const HIDDEN = createPersona(3, 103, "Hidden", true);

const spies: { mockRestore: () => void }[] = [];

function track<T extends { mockRestore: () => void }>(spy: T): T {
  spies.push(spy);
  return spy;
}

afterEach(() => {
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
});

describe("conditioning user targets", () => {
  it("renders every random title variant in every locale without losing embed classification", () => {
    const random = track(spyOn(Math, "random"));
    const failures = collectCaseFailures();
    for (const locale of RUNTIME_LOCALES) {
      for (const [actionKey, type] of Object.entries(CONDITIONING_ACTION_TYPES)) {
        const action = actionKey as keyof typeof CONDITIONING_ACTION_TYPES;
        const keys = CONDITIONING_ACTION_LOCALE_KEYS[action];
        const titleKeys = keys.embed_titles;
        titleKeys.forEach((key, index) => {
          random.mockReturnValue((index + 0.5) / titleKeys.length);
          failures.check(`${locale}/${action}/${key}`, () => {
            const embed = buildConditioningInteractionEmbed({
              locale,
              type,
              actionKey: action,
              actorLabel: "Juno",
              targetName: "Mirri",
              reasonText: "",
              footerKey: null,
            });
            expect(embed.data.title).toBe(localizedCopy(locale, key));
            expect(classifyProtocolTitle(embed.data.title)).toBe(type);
          });
        });
      }
    }
    failures.expectNoFailures();
  });
  it("posts user embeds with names, reasons, and food without loading personas, recording events, or triggering chat", async () => {
    const loadSpy = track(spyOn(personaRepository, "loadState").mockResolvedValue(null));
    const recordSpy = track(spyOn(conditioningMemoryRepository, "recordEvent").mockResolvedValue(null));
    const chatSpy = track(spyOn(tomoriChatModule, "tomoriChat").mockResolvedValue("run"));
    const cases = [
      {
        execute: createConditioningInteractionCommand("reward", "headpat").execute,
        key: "commands.reward.headpat",
        member: { displayName: "Mirri" },
        name: "Mirri",
        withReason: true,
      },
      {
        execute: createConditioningInteractionCommand("punish", "bonk").execute,
        key: "commands.punish.bonk",
        member: { nick: "Juno" },
        name: "Juno",
        withReason: true,
      },
      { execute: executeFeed, key: "commands.reward.feed", member: null, name: "Bau", withReason: true },
      {
        execute: createConditioningInteractionCommand("punish", "bite").execute,
        key: "commands.punish.bite",
        member: null,
        name: "Bau",
        withReason: false,
      },
    ];

    for (const testCase of cases) {
      const { interaction, calls } = makeFakeInteraction({ guild: { id: "guild-1" }, channel: { messages: {} } });
      Object.assign(interaction.options, {
        getUser: () => ({ id: "target-1", displayName: "Bau" }),
        getMember: () => testCase.member,
        getString: (name: string) =>
          name === "reason" && testCase.withReason ? "  being   helpful  " : name === "food" ? "cookies" : null,
      });

      await testCase.execute(client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");

      expect(calls.map((call) => call.method)).toEqual(["reply"]);
      const payload = calls[0].args[0] as { embeds: EmbedBuilder[]; flags: number };
      const embed = payload.embeds[0].toJSON();
      const actionKey = testCase.key.split(".").pop() as ConditioningActionKey;
      expect(
        CONDITIONING_ACTION_LOCALE_KEYS[actionKey].embed_titles.map((key) => localizedCopy("en-US", key)),
      ).toContain(embed.title ?? "");
      const actionDescription = localizedCopy(
        "en-US",
        `${testCase.key}.${testCase.withReason ? "embed_description_with_reason" : "embed_description"}`,
        {
          user: `<@${interaction.user.id}>`,
          bot: "<@target-1>",
          food_text: " `cookies`",
          reason: "being helpful",
        },
      );
      expect(embed.description).toBe(actionDescription);
      expect(embed.footer?.text).toBe(
        testCase.withReason
          ? localizedCopy("en-US", "commands.conditioning.shared.user_footer", { bot: testCase.name })
          : undefined,
      );
      expect(payload.flags).toBe(MessageFlags.SuppressNotifications);
    }

    expect(loadSpy).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("separates an unchanged italic reason with a colon for every action and locale while escaping user Markdown", async () => {
    const failures = collectCaseFailures();
    const reason = "because of *kindness*.";
    const escapedReason = escapeMarkdown(reason);
    for (const locale of RUNTIME_LOCALES) {
      for (const [actionKey, keys] of Object.entries(CONDITIONING_ACTION_LOCALE_KEYS)) {
        const { interaction, calls } = makeFakeInteraction({ guild: { id: "guild-1" }, channel: { messages: {} } });
        Object.assign(interaction.options, {
          getUser: () => ({ id: "target-1", displayName: "Mirri" }),
          getMember: () => null,
          getString: (name: string) => (name === "reason" ? `  ${reason}  ` : name === "food" ? "cookies" : null),
        });
        const execute =
          actionKey === "feed"
            ? executeFeed
            : createConditioningInteractionCommand(
                keys.description.includes(".reward.") ? "reward" : "punish",
                actionKey as keyof typeof CONDITIONING_ACTION_LOCALE_KEYS,
              ).execute;
        await execute(client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), locale);

        failures.check(`${locale}/${actionKey}`, () => {
          const payload = calls[0].args[0] as { embeds: EmbedBuilder[] };
          const embed = payload.embeds[0].toJSON();
          expect(embed.description).toBe(
            localizedCopy(locale, keys.embed_description_with_reason, {
              user: `<@${interaction.user.id}>`,
              bot: "<@target-1>",
              food_text: " `cookies`",
              reason: escapedReason,
            }),
          );
          const action = localizedCopy(locale, keys.embed_description, {
            user: `<@${interaction.user.id}>`,
            bot: "<@target-1>",
            food_text: " `cookies`",
          }).replace(/[.。]$/u, "");
          const separator = ["ja", "zh-TW", "zh-CN"].includes(locale) ? "：" : ": ";
          expect(embed.description).toBe(`${action}${separator}*${escapedReason}*`);
          expect(embed.description).not.toContain("\n");
          expect(embed.footer?.text).toBe(
            localizedCopy(locale, "commands.conditioning.shared.user_footer", { bot: "Mirri" }),
          );
        });
      }
    }
    failures.expectNoFailures();
  });

  it("rejects selecting a user and persona together before recording or triggering chat", async () => {
    const recordSpy = track(spyOn(conditioningMemoryRepository, "recordEvent").mockResolvedValue(null));
    const chatSpy = track(spyOn(tomoriChatModule, "tomoriChat").mockResolvedValue("run"));
    const { interaction, calls } = makeFakeInteraction({ guild: { id: "guild-1" }, channel: { messages: {} } });
    Object.assign(interaction.options, {
      getUser: () => ({ id: "target-1", displayName: "Mirri" }),
      getString: (name: string) => (name === "persona" ? "1" : null),
    });

    await createConditioningInteractionCommand("punish", "bonk").execute(
      client,
      interaction as unknown as ChatInputCommandInteraction,
      createUserRow(),
      "en-US",
    );

    expect(calls.map((call) => call.method)).toEqual(["reply"]);
    const payload = calls[0].args[0] as { embeds: EmbedBuilder[]; flags: number };
    expect(payload.embeds[0].toJSON().description).toBe(
      localizedCopy("en-US", "commands.conditioning.shared.target_conflict_description"),
    );
    expect(payload.flags).toBe(MessageFlags.Ephemeral);
    expect(recordSpy).not.toHaveBeenCalled();
    expect(chatSpy).not.toHaveBeenCalled();
  });
});

/** Builds an interaction that clears every guard ahead of persona resolution. */
function createInteraction(personaOption: string | null) {
  const replies: unknown[] = [];
  const channel = {
    id: "channel-1",
    messages: { fetch: async () => new Map() },
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
  };

  return {
    replies,
    channel,
    interaction: {
      channel,
      guild: {
        id: "guild-1",
        members: { me: { id: "bot" }, cache: { get: () => ({ roles: { cache: [] } }) } },
        channels: { cache: { get: () => channel } },
      },
      user: { id: "user-1" },
      options: {
        getString: (name: string) => (name === "persona" ? personaOption : null),
        getUser: () => null,
      },
      reply: async (payload: unknown) => {
        replies.push(payload);
      },
      fetchReply: async () => ({
        id: "interaction-reply",
        url: "https://discord.com/channels/guild-1/channel-1/interaction-reply",
        channel,
      }),
      deferReply: async () => undefined,
      followUp: async (payload: unknown) => {
        replies.push(payload);
      },
      replied: false,
      deferred: false,
    } as unknown as ChatInputCommandInteraction,
  };
}

/**
 * `restrictedPersonaIds` is the exclusion list: anything absent from it is allowed, and anything
 * present is allowed only when it also appears in `whitelistedPersonaIds`.
 */
function stubWorkspace(available: TomoriState[]): ReturnType<typeof spyOn> {
  const availableIds = new Set(available.map((persona) => persona.persona_id));
  const restricted = [MAIN, ALTER, HIDDEN]
    .map((persona) => persona.persona_id)
    .filter((personaId) => !availableIds.has(personaId));

  track(spyOn(personaRepository, "loadState").mockResolvedValue(MAIN));
  track(spyOn(personaRepository, "loadAllForServer").mockResolvedValue([MAIN, ALTER, HIDDEN]));
  track(
    spyOn(whitelistCache, "getCachedWhitelistStatus").mockResolvedValue({
      isTriggerAllowed: true,
      hasActivePersonaWhitelist: true,
      whitelistedPersonaIds: [],
      restrictedPersonaIds: restricted,
    } as unknown as Awaited<ReturnType<typeof whitelistCache.getCachedWhitelistStatus>>),
  );
  track(
    spyOn(spotlightCache, "getCachedPersonalSpotlightStatus").mockResolvedValue(
      null as unknown as Awaited<ReturnType<typeof spotlightCache.getCachedPersonalSpotlightStatus>>,
    ),
  );
  track(spyOn(tomoriChatModule, "tomoriChat").mockResolvedValue("run"));
  return track(spyOn(conditioningMemoryRepository, "recordEvent").mockResolvedValue(null));
}

const userData = { user_id: 55 } as UserRow;
const client = { user: { id: "bot" } } as unknown as Client;

describe("conditioning persona resolution", () => {
  it("anchors human reward and punish turns to their interaction rather than later channel messages", async () => {
    stubWorkspace([MAIN, ALTER]);
    const chatSpy = track(spyOn(tomoriChatModule, "tomoriChat").mockResolvedValue("run"));
    for (const type of ["reward", "punish"] as const) {
      const { interaction, channel } = createInteraction("2");
      const message = { id: "unrelated-later-message", channel };
      Object.assign(channel.messages, {
        fetch: async () => new Collection([[message.id, message]]),
      });
      await createConditioningInteractionCommand(type, type === "reward" ? "headpat" : "bonk").execute(
        client,
        interaction,
        userData,
        "en-US",
      );
      expect(chatSpy.mock.calls.at(-1)?.[0]).toMatchObject({
        message: { id: "interaction-reply" },
        selectedPersonaId: 2,
        conditioningInteraction: { actorType: "user", type },
      });
      const item = chatSpy.mock.calls.at(-1)?.[0].injectedContextItems?.[0];
      const text = item?.parts.map((part) => (part.type === "text" ? part.text : "")).join("") ?? "";
      expect(item?.role).toBe("system");
      expect(text).toContain(interaction.user.id);
      expect(text).toContain(ALTER.persona_nickname);
      expect(item?.messageId).toBe((await interaction.fetchReply()).id);
      expect(text).not.toContain(message.id);
    }
  });
  it("records against the named persona when the submitted id is eligible", async () => {
    const recordSpy = stubWorkspace([MAIN, ALTER]);
    const { execute } = createConditioningInteractionCommand("punish", "bite");
    const { interaction } = createInteraction("2");

    await execute(client, interaction, userData, "en-US");

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0][0]).toMatchObject({ personaLineageId: 102, conditioningType: "punish" });
  });

  it("writes nothing when the submitted value is not a number", async () => {
    const recordSpy = stubWorkspace([MAIN, ALTER]);
    const { execute } = createConditioningInteractionCommand("punish", "bite");
    const { interaction } = createInteraction("not-an-id");

    await execute(client, interaction, userData, "en-US");

    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("writes nothing when the submitted id does not exist", async () => {
    const recordSpy = stubWorkspace([MAIN, ALTER]);
    const { execute } = createConditioningInteractionCommand("punish", "bite");
    const { interaction } = createInteraction("9999");

    await execute(client, interaction, userData, "en-US");

    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("writes nothing when the submitted id names a persona the actor may not trigger", async () => {
    // HIDDEN exists in the workspace but is outside this actor's whitelist, so a hand-typed id
    // for it must be refused rather than silently accepted or downgraded to the main persona.
    const recordSpy = stubWorkspace([MAIN, ALTER]);
    const { execute } = createConditioningInteractionCommand("punish", "bite");
    const { interaction } = createInteraction("3");

    await execute(client, interaction, userData, "en-US");

    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("resolves through the fallback chain when the option is omitted", async () => {
    const recordSpy = stubWorkspace([MAIN, ALTER]);
    const { execute } = createConditioningInteractionCommand("reward", "headpat");
    const { interaction } = createInteraction(null);

    await execute(client, interaction, userData, "en-US");

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0][0]).toMatchObject({ personaLineageId: 101, conditioningType: "reward" });
  });
});
