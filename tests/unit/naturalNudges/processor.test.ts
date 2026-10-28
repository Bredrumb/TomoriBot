import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { Collection, type Client, type GuildTextBasedChannel, type Message } from "discord.js";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import {
  defaultServerNaturalNudgeConfig,
  NATURAL_NUDGE_CATEGORIES,
  type NaturalNudgeCategory,
  type NaturalNudgeFireRow,
  type PersonaNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";
import * as channelsModule from "@/modules/natural-nudges/runtime/channels";
import * as configCache from "@/modules/natural-nudges/runtime/configCache";
import { BUILTIN_IDLE_NUDGES, idleNudgeNeedsTarget } from "@/modules/natural-nudges/runtime/idleNudges";
import { releaseNudgeServer } from "@/modules/natural-nudges/runtime/inFlight";
import * as metersModule from "@/modules/natural-nudges/runtime/meters";
import * as modelModule from "@/modules/natural-nudges/runtime/model";
import * as partnersModule from "@/modules/natural-nudges/runtime/partners";
import { NaturalNudgeProcessor } from "@/modules/natural-nudges/runtime/processor";
import * as runnerModule from "@/modules/natural-nudges/runtime/runner";
import * as targetsModule from "@/modules/natural-nudges/runtime/targets";
import * as toolsModule from "@/modules/natural-nudges/runtime/tools";
import { DAY_MS, MAX_PLANNER_NUDGES } from "@/modules/natural-nudges/runtime/tuning";
import * as personaCache from "@/utils/cache/tomoriStateCache";
import { statRepository } from "@/utils/db/repositories";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";
import { createCustomIdleNudge, createPersona } from "../../helpers/fixtures";

const SERVER_ID = 7;
const PERSONA_ID = 5;
const PARTNER_ID = 6;
const CHANNEL_IDS = ["1300000000000000001", "1300000000000000002"];
const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  releaseNudgeServer(SERVER_ID);
});

function fixture(category: NaturalNudgeCategory = "start_topic") {
  const enabled = new Set([
    "ping_user.check_in",
    "revive_topic.pick_up_thread",
    "start_topic.show_and_tell",
    "play_scene.banter",
  ]);
  const config = {
    ...defaultServerNaturalNudgeConfig(SERVER_ID),
    channel_disc_ids: [...CHANNEL_IDS],
    disabled_builtin_idle_nudges: BUILTIN_IDLE_NUDGES.filter((nudge) => !enabled.has(nudge.key)).map(
      (nudge) => nudge.key,
    ),
  };
  const personas = [PERSONA_ID, PARTNER_ID].map((persona_id) => createPersona({ persona_id, server_id: SERVER_ID }));
  const personaConfigs = new Map<number, PersonaNaturalNudgeConfig>(
    [PERSONA_ID, PARTNER_ID].map((personaId) => [
      personaId,
      {
        persona_id: personaId,
        talkativeness: 2,
        interests: [],
        idle_nudges: [],
        disabled_idle_nudge_ids: [],
        has_override: true,
        idle_nudges_override: true,
        idle_nudges_inherited: false,
      },
    ]),
  );
  const channels = CHANNEL_IDS.map((id) => ({
    channel: { id, name: "art-gallery", topic: "Artwork welcome." } as GuildTextBasedChannel,
    quietSinceMs: null,
  }));
  const messages = [1, 2].map(
    (index) =>
      ({
        id: `130000000000000001${index}`,
        content: "An earlier art discussion.",
        createdTimestamp: Date.now() - 2 * 60 * 60 * 1000,
        author: { bot: false },
        webhookId: null,
        system: false,
      }) as Message,
  );
  const client = {
    isReady: () => true,
    guilds: { cache: new Collection([["fixture-guild", {}]]) },
  } as unknown as Client;
  const target = {
    userId: 9,
    userDiscId: "1300000000000000009",
    displayName: "Juno",
    channelIds: [...CHANNEL_IDS],
    recentMemories: [],
    activity: null,
  };
  const drawTarget = spyOn(targetsModule, "drawPingUserTarget").mockResolvedValue(target);
  const readMessages = spyOn(channelsModule, "fetchRecentMessages").mockImplementation(async (channel) =>
    channel.id === CHANNEL_IDS[0] ? messages : [],
  );
  const tools = spyOn(toolsModule, "loadAvailableToolNames").mockResolvedValue(new Set(["generate_image"]));
  const customs = spyOn(naturalNudgeRepository, "listCustomIdleNudges").mockResolvedValue([]);
  const scopes = spyOn(naturalNudgeRepository, "loadPersonaScopes").mockResolvedValue(new Map());
  const run = spyOn(runnerModule, "runIdleNudgeAttempt").mockResolvedValue("aborted");
  const drawPartners = spyOn(partnersModule, "drawScenePartners");
  const history: { recent: NaturalNudgeFireRow[]; latestIdleNudges: NaturalNudgeFireRow[] } = {
    recent: [],
    latestIdleNudges: [],
  };
  const drawRaffle = metersModule.drawRaffle;
  const raffle = spyOn(metersModule, "drawRaffle").mockImplementation((entries, random) => {
    const wanted = entries.find(
      (entry) => typeof entry.item === "string" && entry.item === category && entry.tickets > 0,
    );
    if (!wanted) return drawRaffle(entries, random);
    const live = entries.filter((entry) => entry.tickets > 0);
    const before = live.slice(0, live.indexOf(wanted)).reduce((sum, entry) => sum + entry.tickets, 0);
    const total = live.reduce((sum, entry) => sum + entry.tickets, 0);
    return drawRaffle(entries, () => (before + wanted.tickets / 2) / total);
  });
  spies.push(
    raffle,
    drawPartners,
    drawTarget,
    readMessages,
    tools,
    customs,
    scopes,
    run,
    spyOn(Math, "random").mockReturnValue(0),
    spyOn(configCache, "readNaturalNudgeGate").mockResolvedValue({
      serverId: SERVER_ID,
      config,
      channelIds: new Set(CHANNEL_IDS),
      heat: 50,
    }),
    spyOn(naturalNudgeRepository, "pruneBefore").mockResolvedValue({ fires: 0, agendas: 0 }),
    spyOn(naturalNudgeRepository, "listEnabledIdleNudgeServers").mockResolvedValue([
      { server_id: SERVER_ID, server_disc_id: "fixture-guild", timezone_offset: 0, config },
    ]),
    spyOn(naturalNudgeRepository, "loadFireHistory").mockResolvedValue(history),
    spyOn(naturalNudgeRepository, "loadRuntimeState").mockResolvedValue({
      server_id: SERVER_ID,
      stopped_at: null,
      idle_nudge_jitter: 1,
      consecutive_failures: 0,
    }),
    spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(personaConfigs),
    spyOn(naturalNudgeRepository, "loadTargetIdleNudgeFires").mockResolvedValue(new Map()),
    spyOn(statRepository, "getServerActiveHourHistogram").mockResolvedValue([]),
    spyOn(statRepository, "getServerMetricLastAt").mockResolvedValue(null),
    spyOn(metersModule, "resolveWakingHours").mockReturnValue(Array.from({ length: 24 }, () => true)),
    spyOn(modelModule, "resolvePlannerModel").mockResolvedValue({
      kind: "ready",
      llmId: 1,
      slot: "nudge-planner",
      source: "pinned",
    }),
    spyOn(personaCache, "getCachedAllPersonas").mockResolvedValue(personas),
    spyOn(channelsModule, "resolveAllowedChannels").mockResolvedValue(channels),
    spyOn(channelsModule, "buildPlannerTranscript").mockImplementation(async (messages) =>
      messages.map((message) => message.content).join("\n"),
    ),
    spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue({
      hasActiveWhitelist: false,
      hasActiveChannelWhitelist: false,
      isChannelWhitelisted: false,
      hasActiveRoleWhitelist: false,
      isRoleWhitelisted: false,
      hasActivePersonaWhitelist: false,
      isTriggerAllowed: true,
      hasChannelCooldownOverride: false,
    }),
    spyOn(metricSampleRepository, "recordSample").mockResolvedValue(undefined),
  );
  return {
    processor: new NaturalNudgeProcessor(client),
    config,
    personas,
    personaConfigs,
    channels,
    target,
    drawTarget,
    readMessages,
    tools,
    customs,
    scopes,
    run,
    drawPartners,
    history,
  };
}

describe("idle nudge shortlist", () => {
  it("does no server evaluation or provider work while dormant, even with boosted heat", async () => {
    const { processor, config, run, readMessages } = fixture();
    config.heat_offset = 1000;
    const active = spyOn(configCache, "readNaturalNudgeGate").mockResolvedValue(null);
    const history = spyOn(naturalNudgeRepository, "loadFireHistory");
    const model = spyOn(modelModule, "resolvePlannerModel");
    await processor.processDueIdleNudges();
    await processor.processDueIdleNudges();
    expect(history).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(readMessages).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    active.mockResolvedValue({ serverId: SERVER_ID, config, channelIds: new Set(CHANNEL_IDS), heat: 50 });
    await processor.processDueIdleNudges();
    expect(run).toHaveBeenCalledTimes(1);
  });

  const previousFire: NaturalNudgeFireRow = {
    fire_id: 1,
    server_id: SERVER_ID,
    channel_disc_id: CHANNEL_IDS[0],
    persona_id: PARTNER_ID,
    mode: "idle",
    category: "start_topic",
    idle_nudge_key: "start_topic.show_and_tell",
    target_user_id: null,
    opener_message_disc_id: "1300000000000000030",
    answered: true,
    fired_at: new Date(0),
  };

  it.each([2, 4])("excludes the previous category after %s days despite a newer Active Nudge", async (days) => {
    const { processor, history, run } = fixture("start_topic");
    const previous = { ...previousFire, fired_at: new Date(Date.now() - days * DAY_MS) };
    history.latestIdleNudges.push(previous);
    if (days < 3) history.recent.push(previous);
    history.recent.unshift({
      ...previousFire,
      fire_id: 2,
      mode: "active",
      category: null,
      idle_nudge_key: null,
      answered: null,
      fired_at: new Date(Date.now() - DAY_MS),
    });
    await processor.processDueIdleNudges();
    expect(run).toHaveBeenCalledTimes(1);
    const [attempt] = run.mock.calls[0];
    expect(attempt.persona.persona_id).toBe(PERSONA_ID);
    expect(attempt.candidates.every((candidate) => candidate.idleNudge.category !== previous.category)).toBe(true);
  });

  it("rotates types within a sole enabled category before offering the shortlist to the planner", async () => {
    const { processor, config, history, customs, run } = fixture("start_topic");
    config.category_weights = { ping_user: 0, revive_topic: 0, start_topic: 30, play_scene: 0 };
    history.latestIdleNudges.push({ ...previousFire, fired_at: new Date(Date.now() - 4 * DAY_MS) });
    customs.mockResolvedValue([createCustomIdleNudge({ server_id: SERVER_ID })]);
    await processor.processDueIdleNudges();
    expect(run).toHaveBeenCalledTimes(1);
    const [attempt] = run.mock.calls[0];
    expect(attempt.candidates.map((candidate) => candidate.idleNudge.key)).toEqual(["custom:1"]);
  });

  it("remembers the last type in a category across an intervening idle category", async () => {
    const { processor, history, customs, run } = fixture("start_topic");
    history.recent.push({ ...previousFire, fired_at: new Date(Date.now() - 2 * DAY_MS) });
    history.latestIdleNudges.push({
      ...previousFire,
      fire_id: 2,
      category: "ping_user",
      idle_nudge_key: "ping_user.check_in",
      target_user_id: 9,
      fired_at: new Date(Date.now() - DAY_MS),
    });
    customs.mockResolvedValue([createCustomIdleNudge({ server_id: SERVER_ID })]);
    await processor.processDueIdleNudges();
    expect(run).toHaveBeenCalledTimes(1);
    const [attempt] = run.mock.calls[0];
    expect(attempt.candidates.map((candidate) => candidate.idleNudge.key)).toEqual(["custom:1"]);
  });

  it("allows the sole fully eligible type to repeat when another type has no target", async () => {
    const { processor, config, history, customs, tools, drawTarget, run } = fixture("start_topic");
    config.category_weights = { ping_user: 0, revive_topic: 0, start_topic: 30, play_scene: 0 };
    history.latestIdleNudges.push({
      ...previousFire,
      idle_nudge_key: "custom:1",
      fired_at: new Date(Date.now() - DAY_MS),
    });
    tools.mockResolvedValue(new Set());
    drawTarget.mockResolvedValue(null);
    customs.mockResolvedValue([
      createCustomIdleNudge({ server_id: SERVER_ID }),
      createCustomIdleNudge({ custom_idle_nudge_id: 2, server_id: SERVER_ID, prerequisites: ["relationship_user"] }),
    ]);
    await processor.processDueIdleNudges();
    expect(run).toHaveBeenCalledTimes(1);
    const [attempt] = run.mock.calls[0];
    expect(attempt.candidates.map((candidate) => candidate.idleNudge.key)).toEqual(["custom:1"]);
  });

  it.each([
    ...NATURAL_NUDGE_CATEGORIES,
  ])("offers only %s nudges and loads only their supporting context", async (category) => {
    const { processor, run, drawTarget, drawPartners } = fixture(category);
    await processor.processDueIdleNudges();
    expect(run).toHaveBeenCalledTimes(1);
    const [attempt] = run.mock.calls[0];
    expect(attempt.persona.persona_id).toBe(PERSONA_ID);
    expect(new Set(attempt.candidates.map((candidate) => candidate.idleNudge.category))).toEqual(new Set([category]));
    for (const candidate of attempt.candidates) {
      const allowed = candidate.channelIndices.map((index) => attempt.plannerChannels[index].channel.id);
      expect(allowed.length).toBeGreaterThan(0);
      if (candidate.idleNudge.category === "revive_topic") expect(allowed).toEqual([CHANNEL_IDS[0]]);
      if (candidate.idleNudge.category === "play_scene") {
        expect(candidate.partners.map((partner) => partner.persona.persona_id)).toEqual([PARTNER_ID]);
      }
    }
    if (category === "ping_user") expect(drawTarget).toHaveBeenCalledTimes(1);
    else expect(drawTarget).not.toHaveBeenCalled();
    if (category === "play_scene") expect(drawPartners).toHaveBeenCalledTimes(1);
    else expect(drawPartners).not.toHaveBeenCalled();
  });

  it("caps the shortlist and samples without duplicate nudges", async () => {
    const { processor, customs, run } = fixture();
    customs.mockResolvedValue(
      Array.from({ length: MAX_PLANNER_NUDGES + 1 }, (_, index) =>
        createCustomIdleNudge({
          custom_idle_nudge_id: index + 1,
          server_id: SERVER_ID,
          category: "start_topic",
        }),
      ),
    );
    await processor.processDueIdleNudges();
    const [attempt] = run.mock.calls[0];
    expect(attempt.candidates).toHaveLength(MAX_PLANNER_NUDGES);
    expect(new Set(attempt.candidates.map((candidate) => candidate.idleNudge.key)).size).toBe(
      attempt.candidates.length,
    );
    expect(attempt.candidates.every((candidate) => candidate.idleNudge.category === "start_topic")).toBe(true);
  });

  it("draws one shared cast for all offered scene nudges", async () => {
    const { processor, customs, run, drawPartners } = fixture("play_scene");
    customs.mockResolvedValue([
      createCustomIdleNudge({ custom_idle_nudge_id: 1, server_id: SERVER_ID, category: "play_scene" }),
    ]);
    await processor.processDueIdleNudges();
    const [attempt] = run.mock.calls[0];
    expect(attempt.candidates.length).toBeGreaterThan(1);
    expect(drawPartners).toHaveBeenCalledTimes(1);
    for (const candidate of attempt.candidates) expect(candidate.partners).toBe(attempt.candidates[0].partners);
  });

  it("aborts the selected category when no target qualifies without trying another category", async () => {
    const { processor, drawTarget, drawPartners, run } = fixture("ping_user");
    drawTarget.mockResolvedValue(null);
    await processor.processDueIdleNudges();
    expect(drawTarget).toHaveBeenCalledTimes(1);
    expect(drawPartners).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("loads target context for a custom nudge that needs it within another category", async () => {
    const { processor, customs, drawTarget, run } = fixture("start_topic");
    customs.mockResolvedValue([
      createCustomIdleNudge({
        custom_idle_nudge_id: 1,
        server_id: SERVER_ID,
        category: "start_topic",
        prerequisites: ["relationship_user"],
      }),
    ]);
    await processor.processDueIdleNudges();
    expect(drawTarget).toHaveBeenCalledTimes(1);
    const [attempt] = run.mock.calls[0];
    expect(attempt.candidates.every((candidate) => candidate.idleNudge.category === "start_topic")).toBe(true);
    expect(attempt.candidates.some((candidate) => candidate.idleNudge.key === "custom:1")).toBe(true);
    expect(attempt.target).not.toBeNull();
  });

  it("requires combined prerequisites in the same channel and limits scenes to their partners' channels", async () => {
    const { processor, customs, run } = fixture("play_scene");
    customs.mockResolvedValue([
      createCustomIdleNudge({
        custom_idle_nudge_id: 1,
        server_id: SERVER_ID,
        category: "play_scene",
        prerequisites: ["hanging_conversation", "two_personas"],
      }),
    ]);
    spyOn(whitelistRepository, "checkChannelWhitelist").mockImplementation(async (_serverId, channelId) => ({
      hasActiveWhitelist: true,
      hasActiveChannelWhitelist: false,
      isChannelWhitelisted: false,
      hasActiveRoleWhitelist: false,
      isRoleWhitelisted: false,
      hasActivePersonaWhitelist: true,
      restrictedPersonaIds: [PARTNER_ID],
      whitelistedPersonaIds: channelId === CHANNEL_IDS[1] ? [PARTNER_ID] : [],
      isTriggerAllowed: true,
      hasChannelCooldownOverride: false,
    }));
    await processor.processDueIdleNudges();
    const [attempt] = run.mock.calls[0];
    expect(attempt.candidates.some((candidate) => candidate.idleNudge.key === "custom:1")).toBe(false);
    const scene = attempt.candidates.find((candidate) => candidate.idleNudge.category === "play_scene");
    expect(scene?.channelIndices.map((index) => attempt.plannerChannels[index].channel.id)).toEqual([CHANNEL_IDS[1]]);
  });

  it("excludes missing tools, targets, hanging conversations, and silenced scene partners", async () => {
    const { processor, tools, drawTarget, readMessages, personaConfigs, customs, scopes, run } = fixture();
    tools.mockResolvedValue(new Set());
    drawTarget.mockResolvedValue(null);
    readMessages.mockResolvedValue([]);
    const partnerConfig = personaConfigs.get(PARTNER_ID);
    if (!partnerConfig) throw new Error("partner config fixture missing");
    partnerConfig.talkativeness = 0;
    const valid = createCustomIdleNudge({ custom_idle_nudge_id: 1, server_id: SERVER_ID, category: "start_topic" });
    const excluded = createCustomIdleNudge({ custom_idle_nudge_id: 2, server_id: SERVER_ID, category: "start_topic" });
    customs.mockResolvedValue([valid, excluded]);
    scopes.mockResolvedValue(new Map([["custom:2", [PARTNER_ID]]]));
    await processor.processDueIdleNudges();
    const [attempt] = run.mock.calls[0];
    expect(attempt.candidates.map((candidate) => candidate.idleNudge.key)).toEqual(["custom:1"]);
    expect(attempt.target).toBeNull();
  });

  it("keeps a private channel alone when offering alternatives", async () => {
    const { processor, personas, drawTarget, run } = fixture();
    personas[0].config.private_channel_ids = [...CHANNEL_IDS];
    drawTarget.mockResolvedValue(null);
    await processor.processDueIdleNudges();
    const [attempt] = run.mock.calls[0];
    expect(attempt.plannerChannels).toHaveLength(1);
    for (const candidate of attempt.candidates) expect(candidate.channelIndices).toEqual([0]);
  });

  it("limits every alternative to channels the target can view when target context is exposed", async () => {
    const { processor, target, run } = fixture("ping_user");
    target.channelIds = [CHANNEL_IDS[0]];
    await processor.processDueIdleNudges();
    const [attempt] = run.mock.calls[0];
    expect(attempt.target?.userId).toBe(target.userId);
    expect(attempt.candidates.some((candidate) => idleNudgeNeedsTarget(candidate.idleNudge))).toBe(true);
    expect(attempt.plannerChannels.map((entry) => entry.channel.id)).toEqual(target.channelIds);
    for (const candidate of attempt.candidates) expect(candidate.channelIndices).toEqual([0]);
  });
});

describe("server nudge tuning", () => {
  it("draws only categories with positive server weights", async () => {
    const { processor, config, run } = fixture("ping_user");
    config.category_weights = { ping_user: 0, revive_topic: 0, start_topic: 100, play_scene: 0 };
    await processor.processDueIdleNudges();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].candidates.every((candidate) => candidate.idleNudge.category === "start_topic")).toBe(
      true,
    );
  });

  it("sends nothing when every category has zero weight", async () => {
    const { processor, config, run } = fixture();
    config.category_weights = { ping_user: 0, revive_topic: 0, start_topic: 0, play_scene: 0 };
    await processor.processDueIdleNudges();
    expect(run).not.toHaveBeenCalled();
  });

  it("uses refreshed gate heat without reloading cached waking-hours meters", async () => {
    const { processor, config, run } = fixture();
    const gate = spyOn(configCache, "readNaturalNudgeGate").mockResolvedValue({
      serverId: SERVER_ID,
      config,
      channelIds: new Set(CHANNEL_IDS),
      heat: 2,
    });
    const jitter = spyOn(naturalNudgeRepository, "setIdleNudgeJitter").mockResolvedValue(undefined);
    const hours = spyOn(statRepository, "getServerActiveHourHistogram");
    spies.push(jitter);
    run.mockResolvedValue("fired");
    await processor.processDueIdleNudges();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].heat).toBe(2);
    await Bun.sleep(0);
    gate.mockResolvedValue({ serverId: SERVER_ID, config, channelIds: new Set(CHANNEL_IDS), heat: 3 });
    await processor.processDueIdleNudges();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0].heat).toBe(3);
    expect(hours).toHaveBeenCalledTimes(1);
  });
});
