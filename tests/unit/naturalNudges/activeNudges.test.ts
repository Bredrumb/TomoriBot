import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime, spyOn, type Mock } from "bun:test";
import type { StructuredOutputResult } from "@/types/provider/featureInterfaces";
import { Collection, type Client, type GuildTextBasedChannel, type Message } from "discord.js";
import * as tomoriChatModule from "@/events/messageCreate/tomoriChat";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { defaultServerNaturalNudgeConfig, type NaturalNudgeFireRow } from "@/modules/natural-nudges/db/types";
import { naturalNudgePanelDependencies } from "@/modules/natural-nudges/discord/operations";
import * as channels from "@/modules/natural-nudges/runtime/channels";
import {
  ActiveNudgeCheckBudget,
  buildMatcherOptions,
  observeActiveNudgeMessage,
  runActiveNudgeCheck,
  type ActiveNudgeCheck,
} from "@/modules/natural-nudges/runtime/activeNudges";
import * as configCache from "@/modules/natural-nudges/runtime/configCache";
import * as inFlight from "@/modules/natural-nudges/runtime/inFlight";
import * as matcher from "@/modules/natural-nudges/runtime/matcher";
import * as model from "@/modules/natural-nudges/runtime/model";
import {
  ACTIVE_NUDGE_DAILY_CHECK_CAPS,
  ACTIVE_NUDGE_OPTION_BUDGET,
  ACTIVE_NUDGE_QUOTA_PAUSE_MS,
  ACTIVE_NUDGE_STALE_HUMAN_MESSAGES,
  NUDGE_DORMANCY_MS,
} from "@/modules/natural-nudges/runtime/tuning";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import type { TomoriChatInput } from "@/utils/chat/types";
import { statRepository } from "@/utils/db/repositories";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import * as autoTrigger from "@/utils/discord/autoTriggerThreshold";
import { ProviderRequestDeniedError } from "@/utils/provider/providerUsage";
import * as serverStructuredOutput from "@/utils/provider/serverStructuredOutput";
import { createPersona } from "../../helpers/fixtures";

const realResolveMatcherBackend = matcher.resolveMatcherBackend;
const realMatchActiveNudge = matcher.matchActiveNudge;

const SERVER_ID = 7;
const GUILD_ID = "fixture-guild";
const CLIENT_USER_ID = "1300000000000000001";
const ANCHOR_ID = "1300000000000000500";
const MAIN_ID = 5;
const ALTER_ID = 6;
const client = { user: { id: CLIENT_USER_ID }, channels: { cache: new Map() } } as unknown as Client;
const main = createPersona({
  persona_id: MAIN_ID,
  persona_lineage_id: 105,
  server_id: SERVER_ID,
  persona_nickname: "Mirri",
}) as ReturnType<typeof createPersona> & { persona_id: number };
const alter = createPersona({
  persona_id: ALTER_ID,
  persona_lineage_id: 106,
  server_id: SERVER_ID,
  persona_nickname: "Juno",
  is_alter: true,
}) as typeof main;
const MECHA = { label: "mecha anime", description: "Giant piloted robots." };
const BAKING = { label: "baking", description: "Bread and pastry." };
const defaultMatch: matcher.MatcherResult = { choice: "i01", reason: "matched", kind: "llm", model: "fixture" };

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  setSystemTime();
  for (const spy of spies.splice(0)) spy.mockRestore();
});

let canSend = true;

function fakeChannel(id: string, parentId?: string): GuildTextBasedChannel {
  return {
    id,
    parentId: parentId ?? null,
    isThread: () => parentId !== undefined,
    guild: { members: { me: { id: CLIENT_USER_ID } } },
    permissionsFor: () => ({ has: () => canSend }),
    messages: { fetch: async () => new Collection([[ANCHOR_ID, { id: ANCHOR_ID } as Message]]) },
  } as unknown as GuildTextBasedChannel;
}

function fakeMessage(channel: GuildTextBasedChannel, author: { id: string; bot: boolean }): Message {
  return {
    inGuild: () => true,
    system: false,
    guildId: GUILD_ID,
    channelId: channel.id,
    channel,
    webhookId: null,
    author,
  } as unknown as Message;
}

const member = (channel: GuildTextBasedChannel) => fakeMessage(channel, { id: "1300000000000000002", bot: false });
const self = (channel: GuildTextBasedChannel) => fakeMessage(channel, { id: CLIENT_USER_ID, bot: true });

describe("Active Nudge counter", () => {
  let claims: number;
  beforeEach(() => {
    claims = 0;
    spies.push(
      spyOn(configCache, "readNaturalNudgeGate").mockResolvedValue({
        serverId: SERVER_ID,
        config: defaultServerNaturalNudgeConfig(SERVER_ID),
        channelIds: new Set(["listed-parent", "trip-parent", "reset-parent", "quiet-parent"]),
        heat: 15,
      }),
      spyOn(autoTrigger, "rollAutochatTarget").mockReturnValue(3),
      spyOn(inFlight, "claimNudgeServer").mockImplementation(() => {
        claims++;
        return false;
      }),
    );
  });

  it("trips once per rolled count, with a parent and its threads sharing one count", async () => {
    const parent = fakeChannel("trip-parent");
    const thread = fakeChannel("trip-thread", "trip-parent");
    await observeActiveNudgeMessage(client, member(parent));
    await observeActiveNudgeMessage(client, member(thread));
    expect(claims).toBe(0);
    await observeActiveNudgeMessage(client, member(thread));
    expect(claims).toBe(1);
  });

  it("counts neither bots nor members in channels off the list", async () => {
    const listed = fakeChannel("quiet-parent");
    const other = fakeChannel("counter-unlisted");
    for (let index = 0; index < 5; index++) {
      await observeActiveNudgeMessage(client, fakeMessage(listed, { id: "1300000000000000003", bot: true }));
      await observeActiveNudgeMessage(client, member(other));
    }
    expect(claims).toBe(0);
  });

  it("starts over when a persona speaks in the parent or any of its threads", async () => {
    const parent = fakeChannel("reset-parent");
    const thread = fakeChannel("reset-thread", "reset-parent");
    await observeActiveNudgeMessage(client, member(parent));
    await observeActiveNudgeMessage(client, member(parent));
    await observeActiveNudgeMessage(client, self(thread));
    await observeActiveNudgeMessage(client, member(parent));
    await observeActiveNudgeMessage(client, member(thread));
    expect(claims).toBe(0);
    await observeActiveNudgeMessage(client, member(parent));
    expect(claims).toBe(1);
  });
});

describe("matcher options", () => {
  it("merges a shared label into one option and never exceeds the option budget", () => {
    const many = Array.from({ length: ACTIVE_NUDGE_OPTION_BUDGET }, (_, index) => ({
      label: `topic ${index}`,
      description: "Filler.",
    }));
    const configs = new Map([
      [
        MAIN_ID,
        {
          persona_id: MAIN_ID,
          talkativeness: 2,
          interests: [MECHA],
          has_override: true,
          idle_nudges: [],
          disabled_idle_nudge_ids: [],
          idle_nudges_override: false,
          idle_nudges_inherited: false,
        },
      ],
      [
        ALTER_ID,
        {
          persona_id: ALTER_ID,
          talkativeness: 2,
          interests: [{ ...MECHA, label: "Mecha Anime" }],
          has_override: true,
          idle_nudges: [],
          disabled_idle_nudge_ids: [],
          idle_nudges_override: false,
          idle_nudges_inherited: false,
        },
      ],
    ]);
    const shared = buildMatcherOptions([main, alter], configs);
    expect(shared.options).toHaveLength(1);
    expect(
      shared.owners
        .get(shared.options[0].id)
        ?.map((persona) => persona.persona_id)
        .sort(),
    ).toEqual([MAIN_ID, ALTER_ID]);

    configs.set(ALTER_ID, {
      persona_id: ALTER_ID,
      talkativeness: 2,
      interests: many,
      has_override: true,
      idle_nudges: [],
      disabled_idle_nudge_ids: [],
      idle_nudges_override: false,
      idle_nudges_inherited: false,
    });
    const budgeted = buildMatcherOptions([main, alter], configs);
    expect(budgeted.options.length).toBeLessThanOrEqual(ACTIVE_NUDGE_OPTION_BUDGET);
  });
});

describe("Active Nudge check", () => {
  let chatInputs: TomoriChatInput[];
  let samples: Array<Record<string, unknown>>;
  let locked: boolean;
  let window: Message[];
  let configSpy: ReturnType<typeof spyOn<typeof naturalNudgeRepository, "loadServerConfig">>;
  let historySpy: ReturnType<typeof spyOn<typeof naturalNudgeRepository, "loadFireHistory">>;
  let matches: matcher.MatcherResult[];
  let match: Mock<typeof matcher.matchActiveNudge>;
  const channel = fakeChannel("listed-parent");
  const check: ActiveNudgeCheck = {
    client,
    channel,
    listedChannelId: "listed-parent",
    guildId: GUILD_ID,
    serverId: SERVER_ID,
    heat: 15,
  };
  const recordFire = () => spyOn(naturalNudgeRepository, "recordActiveNudgeFire").mockResolvedValue(true);

  beforeEach(() => {
    chatInputs = [];
    samples = [];
    locked = false;
    window = [member(channel)];
    configSpy = spyOn(naturalNudgeRepository, "loadServerConfig");
    configSpy.mockResolvedValue(defaultServerNaturalNudgeConfig(SERVER_ID));
    historySpy = spyOn(naturalNudgeRepository, "loadFireHistory");
    historySpy.mockResolvedValue({ recent: [], latestIdleNudges: [] });
    matches = [];
    match = spyOn(matcher, "matchActiveNudge").mockImplementation(async (args) =>
      args.admitRequest()
        ? (matches.shift() ?? defaultMatch)
        : { choice: null, reason: "check_cap_reached", kind: args.backend.kind, model: args.backend.model },
    );
    spies.push(
      match,
      spyOn(configCache, "isNaturalNudgeServerActive").mockResolvedValue(true),
      spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue([main, alter]),
      spyOn(personaRepository, "loadAllForServer").mockResolvedValue([main, alter]),
      configSpy,
      spyOn(naturalNudgeRepository, "loadRuntimeState").mockResolvedValue({
        server_id: SERVER_ID,
        idle_nudge_jitter: 1,
        consecutive_failures: 0,
        stopped_at: null,
      }),
      historySpy,
      spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(
        new Map([
          [
            MAIN_ID,
            {
              persona_id: MAIN_ID,
              talkativeness: 2,
              interests: [MECHA],
              has_override: true,
              idle_nudges: [],
              disabled_idle_nudge_ids: [],
              idle_nudges_override: false,
              idle_nudges_inherited: false,
            },
          ],
          [
            ALTER_ID,
            {
              persona_id: ALTER_ID,
              talkativeness: 2,
              interests: [BAKING],
              has_override: true,
              idle_nudges: [],
              disabled_idle_nudge_ids: [],
              idle_nudges_override: false,
              idle_nudges_inherited: false,
            },
          ],
        ]),
      ),
      spyOn(channels, "resolveEffectiveChannelIds").mockResolvedValue(["listed-parent"]),
      spyOn(channels, "fetchRecentMessages").mockImplementation(async () => window),
      spyOn(channels, "buildMatcherEvidence").mockResolvedValue("Juno: the new Gundam is out"),
      spyOn(configCache, "readNaturalNudgeGate").mockResolvedValue({
        serverId: SERVER_ID,
        config: defaultServerNaturalNudgeConfig(SERVER_ID),
        channelIds: new Set(),
        heat: 15,
      }),
      spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue(undefined as never),
      spyOn(whitelistRepository, "isPersonaAllowedByWhitelistStatus").mockReturnValue(true),
      spyOn(matcher, "resolveMatcherBackend").mockResolvedValue({
        backend: { kind: "llm", llmId: 1, slot: "nudge-checker", model: "fixture" },
        source: "recommended",
      }),
      spyOn(metricSampleRepository, "recordSample").mockImplementation(async (_name, fields) => {
        samples.push(fields);
      }),
      spyOn(tomoriChatModule, "isChannelProcessingLocked").mockImplementation(() => locked),
      spyOn(tomoriChatModule, "tomoriChat").mockImplementation(async (input) => {
        chatInputs.push(input);
        await input.onGenerationResult?.({
          status: "completed",
          streamResults: [],
          personaResponses: [{}],
          firstDeliveredMessageId: "1300000000000000600",
        } as never);
        return "run";
      }),
    );
    canSend = true;
  });

  const options = (sleep: () => Promise<void> = async () => {}, budget = new ActiveNudgeCheckBudget()) => ({
    sleep,
    random: () => 0.5,
    budget,
  });

  const postHumans = async (count: number) => {
    window = Array.from({ length: count }, () => member(channel));
    for (let index = 0; index < count; index++) await observeActiveNudgeMessage(client, member(channel));
  };

  const useRealMatcher = (respond: () => StructuredOutputResult<{ topic: string }>) => {
    match.mockImplementation(realMatchActiveNudge);
    const request = mock(async () => respond());
    spies.push(
      spyOn(serverStructuredOutput, "resolveServerStructuredModel").mockResolvedValue({
        capability: { callStructuredJSON: request } as never,
        state: main,
        apiKey: "fixture-key",
      }),
      spyOn(model, "resolveStructuredCallTarget").mockResolvedValue({
        model: "fixture",
        maxOutputTokens: 256,
        endpointUrl: undefined,
      }),
    );
    return request;
  };

  it("skips dormant checks before persona, settings, history, or matcher work", async () => {
    spyOn(configCache, "readNaturalNudgeGate").mockResolvedValue(null);
    expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
    expect(tomoriStateCache.getCachedAllPersonas).not.toHaveBeenCalled();
    expect(configSpy).not.toHaveBeenCalled();
    expect(historySpy).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
    expect(chatInputs).toHaveLength(0);
    expect(samples.at(-1)).toMatchObject({ reason: "dormant" });
  });

  it("drops a matched nudge when dormancy begins during its delay", async () => {
    let active = true;
    spyOn(configCache, "isNaturalNudgeServerActive").mockImplementation(async () => active);
    expect(
      await runActiveNudgeCheck(check, {
        ...options(),
        sleep: async () => {
          active = false;
        },
      }),
    ).toBe("aborted");
    expect(match).toHaveBeenCalledTimes(1);
    expect(chatInputs).toHaveLength(0);
    expect(samples.at(-1)).toMatchObject({ reason: "dormant" });
  });

  it("speaks as the interest's owner, told which interest drew it in, and records the fire", async () => {
    const fire = recordFire();
    spies.push(fire);
    expect(await runActiveNudgeCheck(check, options())).toBe("fired");
    const [input] = chatInputs;
    expect(input).toMatchObject({
      selectedPersonaId: MAIN_ID,
      naturalNudge: { toolNames: [] },
      borrowsTriggerMessage: true,
      shouldSurfaceUserErrors: false,
    });
    const frame = JSON.stringify(input.injectedContextItems);
    expect(frame).toContain(MECHA.label);
    expect(frame).not.toContain(BAKING.label);
    expect(input.message.id).toBe(ANCHOR_ID);
    expect(fire.mock.calls[0][0]).toMatchObject({
      personaId: MAIN_ID,
      openerMessageDiscId: "1300000000000000600",
      detour: false,
    });
  });

  it("never detours to a persona who already spoke in the window", async () => {
    spies.push(
      recordFire(),
      spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(
        new Map([
          [
            MAIN_ID,
            {
              persona_id: MAIN_ID,
              talkativeness: 2,
              interests: [],
              has_override: true,
              idle_nudges: [],
              disabled_idle_nudge_ids: [],
              idle_nudges_override: false,
              idle_nudges_inherited: false,
            },
          ],
          [
            ALTER_ID,
            {
              persona_id: ALTER_ID,
              talkativeness: 2,
              interests: [MECHA],
              has_override: true,
              idle_nudges: [],
              disabled_idle_nudge_ids: [],
              idle_nudges_override: false,
              idle_nudges_inherited: false,
            },
          ],
        ]),
      ),
      spyOn(statRepository, "getServerPersonaMessageCounts").mockResolvedValue(
        new Map([[main.persona_lineage_id, 50]]),
      ),
    );
    window = [member(channel), self(channel)];
    expect(await runActiveNudgeCheck(check, { sleep: async () => {}, random: () => 0.05 })).toBe("fired");
    expect(chatInputs.map((input) => input.selectedPersonaId)).toEqual([ALTER_ID]);
  });

  it("holds the hourly cap for a parent after an Active Nudge in one of its threads", async () => {
    const cache = (client as unknown as { channels: { cache: Map<string, unknown> } }).channels.cache;
    cache.set("cap-thread", { isThread: () => true, parentId: "listed-parent" });
    historySpy.mockResolvedValue({
      recent: [
        {
          fire_id: 1,
          server_id: SERVER_ID,
          channel_disc_id: "cap-thread",
          persona_id: MAIN_ID,
          mode: "active",
          category: null,
          idle_nudge_key: null,
          target_user_id: null,
          opener_message_disc_id: ANCHOR_ID,
          answered: null,
          fired_at: new Date(Date.now() - 10 * 60_000),
        },
      ],
      latestIdleNudges: [],
    });
    try {
      expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
      expect(samples.at(-1)).toMatchObject({ reason: "channel_cap", phase: "a" });
    } finally {
      cache.delete("cap-thread");
    }
  });

  it("counts today's Active Nudges against the level's cap", async () => {
    spies.push(recordFire());
    const CAP_BY_LEVEL = [
      [0, 1],
      [1, 3],
      [2, 6],
      [3, 10],
    ] as const;
    const activeNudgeFire = (fireId: number): NaturalNudgeFireRow => ({
      fire_id: fireId,
      server_id: SERVER_ID,
      channel_disc_id: "cap-other-channel",
      persona_id: MAIN_ID,
      mode: "active",
      category: null,
      idle_nudge_key: null,
      target_user_id: null,
      opener_message_disc_id: ANCHOR_ID,
      answered: null,
      fired_at: new Date(),
    });

    for (const [level, cap] of CAP_BY_LEVEL) {
      configSpy.mockResolvedValue({ ...defaultServerNaturalNudgeConfig(SERVER_ID), active_nudge_frequency: level });
      const fired = Array.from({ length: cap }, (_, index) => activeNudgeFire(index + 1));

      historySpy.mockResolvedValue({ recent: fired, latestIdleNudges: [] });
      expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
      expect(samples.at(-1)).toMatchObject({ reason: "cap_reached", phase: "a" });

      historySpy.mockResolvedValue({ recent: fired.slice(1), latestIdleNudges: [] });
      expect(await runActiveNudgeCheck(check, options())).toBe("fired");
    }
  });

  it("lifts a failure stop itself once a turn has succeeded since, so idle nudges being off cannot strand it", async () => {
    const stoppedAt = new Date("2026-10-21T16:06:23Z");
    const clear = spyOn(naturalNudgeRepository, "clearFailures").mockResolvedValue(undefined);
    const lastTurn = spyOn(statRepository, "getServerMetricLastAt").mockResolvedValue(new Date("2026-10-21T16:05:00Z"));
    spies.push(
      clear,
      lastTurn,
      recordFire(),
      spyOn(naturalNudgeRepository, "loadRuntimeState").mockResolvedValue({
        server_id: SERVER_ID,
        idle_nudge_jitter: 1,
        consecutive_failures: 3,
        stopped_at: stoppedAt,
      }),
    );
    expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ reason: "stopped" });
    expect(clear).not.toHaveBeenCalled();

    lastTurn.mockResolvedValue(new Date("2026-10-21T16:07:18Z"));
    expect(await runActiveNudgeCheck(check, options())).toBe("fired");
    expect(clear).toHaveBeenCalledWith(SERVER_ID);
  });

  it("skips a channel where the bot cannot send, before any matcher call", async () => {
    canSend = false;
    expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ reason: "no_send_permission", phase: "a" });
    expect(matcher.matchActiveNudge).not.toHaveBeenCalled();
  });

  it("offers only interests with an owner who has not spoken in the window", async () => {
    spies.push(recordFire());
    window = [member(channel), self(channel)];
    expect(await runActiveNudgeCheck(check, options())).toBe("fired");
    expect(match.mock.calls[0][0].options.map((option) => option.text)).toEqual([
      `${BAKING.label}: ${BAKING.description}`,
    ]);
    expect(chatInputs[0].selectedPersonaId).toBe(ALTER_ID);
  });

  it("skips matching when every interest owner already spoke", async () => {
    spies.push(spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue([main]));
    window = [member(channel), self(channel)];
    expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
    expect(match).not.toHaveBeenCalled();
    expect(samples.at(-1)).toMatchObject({ reason: "no_interests", phase: "a" });
  });

  it("keeps a shared interest when one of its owners already spoke", async () => {
    const configs = await naturalNudgeRepository.loadPersonaConfigs([MAIN_ID, ALTER_ID]);
    const alterConfig = configs.get(ALTER_ID);
    if (!alterConfig) throw new Error("Missing persona config fixture");
    configs.set(ALTER_ID, { ...alterConfig, interests: [MECHA] });
    spies.push(spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(configs), recordFire());
    window = [member(channel), self(channel)];
    expect(await runActiveNudgeCheck(check, options())).toBe("fired");
    expect(match.mock.calls[0][0].options.map((option) => option.text)).toEqual([
      `${MECHA.label}: ${MECHA.description}`,
    ]);
    expect(chatInputs[0].selectedPersonaId).toBe(ALTER_ID);
  });

  it("skips the initial matcher when the channel is busy or a persona replied during its reads", async () => {
    locked = true;
    expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ reason: "channel_busy", phase: "a" });
    locked = false;
    spies.push(
      spyOn(channels, "buildMatcherEvidence").mockImplementation(async () => {
        await observeActiveNudgeMessage(client, self(channel));
        return "Juno: a new Gundam";
      }),
    );
    expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ reason: "persona_spoke", phase: "a" });
    expect(match).not.toHaveBeenCalled();
  });

  it("aborts after the delay when a persona spoke or the channel became busy, before any re-match", async () => {
    const cases: Array<[string, () => Promise<void>]> = [
      [
        "persona_spoke",
        async () => {
          await postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES);
          await observeActiveNudgeMessage(client, self(channel));
        },
      ],
      [
        "channel_busy",
        async () => {
          await postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES);
          locked = true;
        },
      ],
    ];
    for (const [reason, duringDelay] of cases) {
      locked = false;
      match.mockClear();
      expect(await runActiveNudgeCheck(check, options(duringDelay))).toBe("aborted");
      expect(samples.at(-1)).toMatchObject({ reason, phase: "c" });
      expect(match).toHaveBeenCalledTimes(1);
    }
    expect(chatInputs).toEqual([]);
  });

  it("re-matches a filled window and speaks when the same interest wins again", async () => {
    spies.push(recordFire());
    matches = [
      defaultMatch,
      { choice: "i01", reason: "matched", kind: "llm", model: "fixture", usage: { inputTokens: 40, outputTokens: 5 } },
    ];
    expect(
      await runActiveNudgeCheck(
        check,
        options(() => postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES)),
      ),
    ).toBe("fired");
    expect(match).toHaveBeenCalledTimes(2);
    expect(match.mock.calls[1][0].options).toEqual(match.mock.calls[0][0].options);
    expect(channels.buildMatcherEvidence).toHaveBeenLastCalledWith(window, GUILD_ID);
    expect(chatInputs.map((input) => input.selectedPersonaId)).toEqual([MAIN_ID]);
    expect(samples.at(-1)).toMatchObject({
      outcome: "fired",
      phase: "c",
      reason: "delivered",
      rematched: 1,
      rematch_tokens_in: 40,
      rematch_tokens_out: 5,
    });
  });

  it("aborts with window_gone when the re-match picks another interest or none", async () => {
    const seconds: matcher.MatcherResult[] = [
      { choice: "i02", reason: "matched", kind: "llm", model: "fixture" },
      { choice: null, reason: "none", kind: "llm", model: "fixture" },
    ];
    for (const second of seconds) {
      match.mockClear();
      window = [member(channel)];
      matches = [defaultMatch, second];
      expect(
        await runActiveNudgeCheck(
          check,
          options(() => postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES)),
        ),
      ).toBe("aborted");
      expect(match).toHaveBeenCalledTimes(2);
      expect(samples.at(-1)).toMatchObject({
        outcome: "aborted",
        phase: "c",
        reason: "window_gone",
        rematched: 1,
      });
      expect(chatInputs).toEqual([]);
    }
  });

  it("makes no second matcher call below the stale threshold", async () => {
    spies.push(recordFire());
    expect(
      await runActiveNudgeCheck(
        check,
        options(() => postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES - 1)),
      ),
    ).toBe("fired");
    expect(match).toHaveBeenCalledTimes(1);
    expect(samples.at(-1)).toMatchObject({ outcome: "fired", phase: "c", rematched: 0 });
  });

  it("aborts quietly when the second matcher call fails", async () => {
    const failure = spyOn(naturalNudgeRepository, "recordFailure").mockResolvedValue(null);
    spies.push(failure);
    matches = [defaultMatch, { choice: null, reason: "failed", kind: "llm", model: "fixture" }];
    expect(
      await runActiveNudgeCheck(
        check,
        options(() => postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES)),
      ),
    ).toBe("aborted");
    expect(match).toHaveBeenCalledTimes(2);
    expect(samples.at(-1)).toMatchObject({
      outcome: "aborted",
      phase: "c",
      reason: "matcher_failed",
      rematched: 1,
    });
    expect(failure).not.toHaveBeenCalled();
    expect(chatInputs).toEqual([]);
  });

  it("aborts when a persona speaks or the channel locks during the second matcher call", async () => {
    const cases: Array<[string, () => Promise<void>]> = [
      ["persona_spoke", () => observeActiveNudgeMessage(client, self(channel))],
      [
        "channel_busy",
        async () => {
          locked = true;
        },
      ],
    ];
    for (const [reason, duringMatch] of cases) {
      locked = false;
      match.mockClear();
      matches = [defaultMatch, defaultMatch];
      let calls = 0;
      match.mockImplementation(async () => {
        calls++;
        const result = matches.shift() ?? defaultMatch;
        if (calls === 2) await duringMatch();
        return result;
      });
      expect(
        await runActiveNudgeCheck(
          check,
          options(() => postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES)),
        ),
      ).toBe("aborted");
      expect(match).toHaveBeenCalledTimes(2);
      expect(samples.at(-1)).toMatchObject({
        outcome: "aborted",
        phase: "c",
        reason,
        rematched: 1,
      });
      expect(chatInputs).toEqual([]);
    }
  });

  it("aborts when the re-match window shows the chosen speaker already spoke", async () => {
    const duringDelay = async () => {
      await postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES);
      window = [...window.slice(1), self(channel)];
    };
    expect(await runActiveNudgeCheck(check, options(duringDelay))).toBe("aborted");
    expect(match).toHaveBeenCalledTimes(1);
    expect(samples.at(-1)).toMatchObject({ outcome: "aborted", phase: "c", reason: "persona_spoke" });
    expect(chatInputs).toEqual([]);
  });

  it("reads an untrusted matcher answer as no fire", async () => {
    match.mockResolvedValue({ choice: null, reason: "refused", kind: "llm", model: "fixture" });
    expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ reason: "matcher_refused" });
    expect(chatInputs).toEqual([]);
  });

  it("stops calling the checker once the day's check cap is spent, re-matches included", async () => {
    spies.push(recordFire());
    let topic = "none";
    const request = useRealMatcher(() => ({ success: true, data: { topic } }));
    const budget = new ActiveNudgeCheckBudget();
    const cap = ACTIVE_NUDGE_DAILY_CHECK_CAPS[defaultServerNaturalNudgeConfig(SERVER_ID).active_nudge_frequency];
    for (let index = 0; index < cap - 1; index++) await runActiveNudgeCheck(check, options(undefined, budget));
    expect(request).toHaveBeenCalledTimes(cap - 1);

    topic = "i01";
    const duringDelay = () => postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES);
    expect(await runActiveNudgeCheck(check, options(duringDelay, budget))).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ phase: "c", reason: "check_cap_reached", rematched: 0 });
    expect(await runActiveNudgeCheck(check, options(undefined, budget))).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ phase: "a", reason: "check_cap_reached" });
    expect(request).toHaveBeenCalledTimes(cap);
    expect(chatInputs).toEqual([]);
  });

  it("exhausts the actual checker request allowance through malformed responses", async () => {
    const request = useRealMatcher(() => ({
      success: false,
      error: "fixture",
      failure: "malformed",
      malformed: { reason: "unparsable" },
    }));
    const budget = new ActiveNudgeCheckBudget();
    const cap = ACTIVE_NUDGE_DAILY_CHECK_CAPS[defaultServerNaturalNudgeConfig(SERVER_ID).active_nudge_frequency];
    for (let attempt = 0; attempt <= cap; attempt++) {
      expect(await runActiveNudgeCheck(check, options(undefined, budget))).toBe("aborted");
    }
    expect(request).toHaveBeenCalledTimes(cap);
    expect(samples.at(-1)).toMatchObject({ reason: "check_cap_reached", phase: "a" });
    expect(chatInputs).toEqual([]);
  });

  it("pauses the server after a checker answers HTTP 429", async () => {
    const budget = new ActiveNudgeCheckBudget();
    match.mockResolvedValue({ choice: null, reason: "failed", kind: "llm", model: "fixture", rateLimited: true });
    expect(await runActiveNudgeCheck(check, options(undefined, budget))).toBe("failed");
    expect(budget.isPaused(SERVER_ID, Date.now())).toBe(true);
    expect(budget.isPaused(SERVER_ID, Date.now() + ACTIVE_NUDGE_QUOTA_PAUSE_MS)).toBe(false);
  });

  it("pauses the server when the pinned checker's paying option refuses before any check", async () => {
    const budget = new ActiveNudgeCheckBudget();
    configSpy.mockResolvedValue({ ...defaultServerNaturalNudgeConfig(SERVER_ID), checker_llm_id: 9 });
    (matcher.resolveMatcherBackend as Mock<typeof matcher.resolveMatcherBackend>).mockImplementation(
      realResolveMatcherBackend,
    );
    spies.push(
      spyOn(serverStructuredOutput, "resolveServerStructuredModel").mockRejectedValue(
        new ProviderRequestDeniedError(undefined, () => ({ titleKey: "fixture", description: "fixture" })),
      ),
    );
    expect(await runActiveNudgeCheck(check, options(undefined, budget))).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ phase: "a", reason: "matcher_denied" });
    expect(budget.isPaused(SERVER_ID, Date.now())).toBe(true);
    expect(match).not.toHaveBeenCalled();
  });
});

describe("advanced heat and the active gate cache", () => {
  it("refreshes a gate that becomes dormant while its eligibility read is still loading", async () => {
    const serverId = 7021;
    const guildId = "fixture-loading-boundary";
    const now = new Date();
    const daily = new Map([[now.toISOString().slice(0, 10), 10]]);
    let finishCounts: (value: Map<string, number>) => void = () => undefined;
    let countsStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      countsStarted = resolve;
    });
    const pending = new Promise<Map<string, number>>((resolve) => {
      finishCounts = resolve;
    });
    const counts = spyOn(statRepository, "getServerDailyHeatCounts")
      .mockImplementationOnce(() => {
        countsStarted();
        return pending;
      })
      .mockResolvedValue(daily);
    const settings = spyOn(naturalNudgeRepository, "loadServerConfig").mockResolvedValue({
      ...defaultServerNaturalNudgeConfig(serverId),
      channel_disc_ids: ["eligible-parent"],
    });
    const personas = spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue([
      createPersona({ server_id: serverId }),
    ]);
    const activity = spyOn(naturalNudgeRepository, "loadLastDirectChatAt").mockResolvedValue(
      new Date(now.getTime() - NUDGE_DORMANCY_MS + 1000),
    );
    const record = spyOn(naturalNudgeRepository, "recordDirectChat").mockImplementation(async () => new Date());
    spies.push(counts, settings, personas, activity, record);
    try {
      setSystemTime(now);
      const loading = configCache.readNaturalNudgeGate(guildId);
      await started;
      setSystemTime(new Date(now.getTime() + 1000));
      expect(await configCache.readNaturalNudgeGate(guildId)).toBeNull();
      finishCounts(daily);
      await loading;
      await configCache.recordNaturalNudgeDirectChat(serverId);
      expect(await configCache.readNaturalNudgeGate(guildId)).not.toBeNull();
      expect(counts).toHaveBeenCalledTimes(2);
    } finally {
      finishCounts(daily);
      configCache.invalidateNaturalNudgeConfigCache(serverId);
    }
  });

  it("keeps eligible snapshots across direct chats and stat flushes until their TTL expires", async () => {
    const serverId = 7020;
    const guildId = "fixture-active-cache";
    const now = new Date();
    const settings = spyOn(naturalNudgeRepository, "loadServerConfig").mockResolvedValue({
      ...defaultServerNaturalNudgeConfig(serverId),
      channel_disc_ids: ["eligible-parent"],
    });
    const counts = spyOn(statRepository, "getServerDailyHeatCounts").mockResolvedValue(
      new Map([[now.toISOString().slice(0, 10), 10]]),
    );
    const load = spyOn(naturalNudgeRepository, "loadLastDirectChatAt").mockResolvedValue(now);
    const record = spyOn(naturalNudgeRepository, "recordDirectChat").mockResolvedValue(now);
    const personas = spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue([
      createPersona({ server_id: serverId }),
    ]);
    spies.push(settings, counts, load, record, personas);
    try {
      setSystemTime(now);
      const gate = await configCache.readNaturalNudgeGate(guildId);
      expect(gate).not.toBeNull();
      for (let index = 0; index < 3; index++) {
        await configCache.recordNaturalNudgeDirectChat(serverId);
        configCache.invalidateInactiveNaturalNudgeGates(serverId);
        expect(await configCache.readNaturalNudgeGate(guildId)).toBe(gate);
      }
      expect(settings).toHaveBeenCalledTimes(1);
      expect(counts).toHaveBeenCalledTimes(1);
      setSystemTime(new Date(now.getTime() + 5 * 60 * 1000));
      expect(await configCache.readNaturalNudgeGate(guildId)).not.toBeNull();
      expect(settings).toHaveBeenCalledTimes(2);
      expect(counts).toHaveBeenCalledTimes(2);
    } finally {
      configCache.invalidateNaturalNudgeConfigCache(serverId);
    }
  });

  it.each([
    "low_heat",
    "no_channels",
  ] as const)("caches %s dormancy through chatter and time until direct chat refreshes eligibility", async (reason) => {
    const serverId = reason === "low_heat" ? 7010 : 7011;
    const guildId = `fixture-dormant-${reason}`;
    const config = { ...defaultServerNaturalNudgeConfig(serverId), heat_offset: 1000 };
    const load = spyOn(naturalNudgeRepository, "loadLastDirectChatAt").mockResolvedValue(new Date());
    const record = spyOn(naturalNudgeRepository, "recordDirectChat").mockResolvedValue(new Date());
    const personas = spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue([
      createPersona({ server_id: serverId }),
    ]);
    const settings = spyOn(naturalNudgeRepository, "loadServerConfig").mockResolvedValue(config);
    const daily = new Map([[new Date().toISOString().slice(0, 10), 10]]);
    const counts = spyOn(statRepository, "getServerDailyHeatCounts").mockResolvedValue(
      reason === "low_heat" ? new Map() : daily,
    );
    const automatic = spyOn(naturalNudgeRepository, "loadAutomaticChannelIds").mockResolvedValue(
      reason === "no_channels" ? [] : ["eligible-parent"],
    );
    const claim = spyOn(inFlight, "claimNudgeServer").mockReturnValue(false);
    spies.push(load, record, personas, settings, counts, automatic, claim);
    try {
      expect(await configCache.readNaturalNudgeGate(guildId)).toBeNull();
      setSystemTime(new Date(Date.now() + 20 * 60 * 1000));
      for (let index = 0; index < 10; index++) {
        const message = member(fakeChannel("eligible-parent"));
        Object.assign(message, { guildId });
        await observeActiveNudgeMessage(client, message);
      }
      expect(settings).toHaveBeenCalledTimes(1);
      expect(counts).toHaveBeenCalledTimes(1);
      expect(personas).toHaveBeenCalledTimes(1);
      expect(claim).not.toHaveBeenCalled();
      counts.mockResolvedValue(daily);
      automatic.mockResolvedValue(["eligible-parent"]);
      expect(await configCache.readNaturalNudgeGate(guildId)).toBeNull();
      await configCache.recordNaturalNudgeDirectChat(serverId);
      expect((await configCache.readNaturalNudgeGate(guildId))?.channelIds.has("eligible-parent")).toBe(true);
      expect(settings).toHaveBeenCalledTimes(2);
    } finally {
      configCache.invalidateNaturalNudgeConfigCache(serverId);
    }
  });

  it("keeps unused servers dormant through chatter and cache expiry, and wakes only after a successful direct-chat write", async () => {
    const serverId = 7001;
    const persona = createPersona({ server_id: serverId });
    const config = {
      ...defaultServerNaturalNudgeConfig(serverId),
      channel_disc_ids: ["dormant-parent"],
      heat_offset: 1000,
    };
    const loadActivity = spyOn(naturalNudgeRepository, "loadLastDirectChatAt").mockResolvedValue(null);
    const recordActivity = spyOn(naturalNudgeRepository, "recordDirectChat").mockRejectedValue(new Error("fixture"));
    const loadConfig = spyOn(naturalNudgeRepository, "loadServerConfig").mockResolvedValue(config);
    const personas = spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue([persona]);
    const counts = spyOn(statRepository, "getServerDailyHeatCounts").mockResolvedValue(new Map());
    const claim = spyOn(inFlight, "claimNudgeServer").mockReturnValue(false);
    const channel = fakeChannel("dormant-parent");
    configCache.invalidateNaturalNudgeConfigCache(serverId);
    spies.push(loadActivity, recordActivity, loadConfig, personas, counts, claim);
    try {
      for (let index = 0; index < 10; index++) await observeActiveNudgeMessage(client, member(channel));
      setSystemTime(new Date(Date.now() + 20 * 60 * 1000));
      for (let index = 0; index < 10; index++) await observeActiveNudgeMessage(client, member(channel));
      expect(loadActivity).toHaveBeenCalledTimes(1);
      expect(personas).toHaveBeenCalledTimes(1);
      expect(loadConfig).not.toHaveBeenCalled();
      expect(counts).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
      await configCache.recordNaturalNudgeDirectChat(serverId);
      expect(await configCache.readNaturalNudgeGate(GUILD_ID)).toBeNull();
      recordActivity.mockResolvedValue(new Date());
      await configCache.recordNaturalNudgeDirectChat(serverId);
      counts.mockResolvedValue(new Map([[new Date().toISOString().slice(0, 10), 10]]));
      expect((await configCache.readNaturalNudgeGate(GUILD_ID))?.heat).toBe(50);
      expect(loadConfig).toHaveBeenCalledTimes(1);
      setSystemTime(new Date(Date.now() + NUDGE_DORMANCY_MS));
      expect(await configCache.readNaturalNudgeGate(GUILD_ID)).toBeNull();
      expect(loadActivity).toHaveBeenCalledTimes(1);
      expect(loadConfig).toHaveBeenCalledTimes(1);
    } finally {
      configCache.invalidateNaturalNudgeConfigCache(serverId);
    }
  });

  it("shares activity reads and retries a failed read without caching a dormant result", async () => {
    const load = spyOn(naturalNudgeRepository, "loadLastDirectChatAt")
      .mockRejectedValueOnce(new Error("fixture"))
      .mockResolvedValue(new Date());
    try {
      const first = await Promise.allSettled([
        configCache.isNaturalNudgeServerActive(7002),
        configCache.isNaturalNudgeServerActive(7002),
      ]);
      expect(first.map((result) => result.status)).toEqual(["rejected", "rejected"]);
      expect(load).toHaveBeenCalledTimes(1);
      expect(await configCache.isNaturalNudgeServerActive(7002)).toBe(true);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      load.mockRestore();
    }
  });

  it("closes a still-cached active gate exactly at the dormancy boundary", async () => {
    const serverId = 7003;
    const now = new Date();
    const load = spyOn(naturalNudgeRepository, "loadLastDirectChatAt").mockResolvedValue(
      new Date(now.getTime() - NUDGE_DORMANCY_MS + 30_000),
    );
    const personas = spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue([
      createPersona({ server_id: serverId }),
    ]);
    const config = spyOn(naturalNudgeRepository, "loadServerConfig").mockResolvedValue({
      ...defaultServerNaturalNudgeConfig(serverId),
      channel_disc_ids: ["listed-parent"],
      heat_offset: 5,
    });
    const counts = spyOn(statRepository, "getServerDailyHeatCounts").mockResolvedValue(
      new Map([[now.toISOString().slice(0, 10), 10]]),
    );
    spies.push(load, personas, config, counts);
    try {
      setSystemTime(now);
      expect((await configCache.readNaturalNudgeGate(GUILD_ID))?.heat).toBeGreaterThan(5);
      setSystemTime(new Date(now.getTime() + 30_000));
      expect(await configCache.readNaturalNudgeGate(GUILD_ID)).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
      expect(personas).toHaveBeenCalledTimes(1);
      expect(config).toHaveBeenCalledTimes(1);
    } finally {
      configCache.invalidateNaturalNudgeConfigCache(serverId);
    }
  });

  it("refreshes effective heat after successful adjustments and keeps the cached gate on write failure", async () => {
    const config = defaultServerNaturalNudgeConfig(SERVER_ID);
    config.channel_disc_ids = ["listed-parent"];
    configCache.invalidateNaturalNudgeConfigCache(SERVER_ID);
    const load = spyOn(naturalNudgeRepository, "loadServerConfig").mockImplementation(async () => ({ ...config }));
    const adjust = spyOn(naturalNudgeRepository, "adjustHeat").mockImplementation(async () => {
      config.heat_offset += 5;
      return true;
    });
    const personas = spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue([main]);
    const activity = spyOn(configCache, "isNaturalNudgeServerActive").mockResolvedValue(true);
    const daily = new Map([[new Date().toISOString().slice(0, 10), 10]]);
    const counts = spyOn(statRepository, "getServerDailyHeatCounts").mockResolvedValue(daily);
    spies.push(load, adjust, personas, counts, activity);
    try {
      const initialHeat = (await configCache.readNaturalNudgeGate(GUILD_ID))?.heat ?? 0;
      expect(initialHeat).toBeGreaterThan(1);
      expect(await naturalNudgePanelDependencies.operations.adjustHeat(SERVER_ID, "up")).toBe("success");
      const heated = await configCache.readNaturalNudgeGate(GUILD_ID);
      expect(heated?.heat).toBe(initialHeat + 5);
      adjust.mockResolvedValue(false);
      expect(await naturalNudgePanelDependencies.operations.adjustHeat(SERVER_ID, "up")).toBe("write-failed");
      expect(await configCache.readNaturalNudgeGate(GUILD_ID)).toBe(heated);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      configCache.invalidateNaturalNudgeConfigCache(SERVER_ID);
    }
  });
});
