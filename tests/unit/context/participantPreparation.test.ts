import { describe, expect, it, spyOn } from "bun:test";
import { createChatLatencyInvocation, measureChatTurnStage, runWithChatTurnLatency } from "@/utils/chat/turnLatency";
import { log } from "@/utils/misc/logger";
import type { TomoriState } from "@/types/db/schema";
import {
  createParticipantRequestScope,
  prepareParticipantContext,
  type PreparedParticipantContext,
} from "@/utils/text/participants/preparation";
import {
  createParticipantContextFixture,
  PARTICIPANT_FIXTURE_IDS,
  type ParticipantContextFixture,
} from "./fixtures/participantContextFixture";

function visibleParticipantIds(): string[] {
  return [
    PARTICIPANT_FIXTURE_IDS.human,
    PARTICIPANT_FIXTURE_IDS.bot,
    `persona:${PARTICIPANT_FIXTURE_IDS.historicalPersona}`,
    PARTICIPANT_FIXTURE_IDS.webhook,
  ];
}

function prepare(
  fixture: ParticipantContextFixture,
  activePersona: TomoriState,
  requestScope = createParticipantRequestScope(),
  history = fixture.history,
): Promise<PreparedParticipantContext> {
  return prepareParticipantContext({
    client: fixture.client,
    guildId: PARTICIPANT_FIXTURE_IDS.guild,
    simplifiedMessageHistory: history,
    personas: fixture.personas,
    activePersona,
    visibleUserIds: visibleParticipantIds(),
    syntheticUsers: fixture.syntheticUsers,
    matrixUsers: fixture.matrixUsers,
    requestScope,
  });
}

describe("participant context preparation", () => {
  it("measures concurrent member lookup wall time and excludes cached discovery work from later turns", async () => {
    const fixture = createParticipantContextFixture();
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    let now = 0;
    const clock = spyOn(performance, "now").mockImplementation(() => now);
    const requestScope = createParticipantRequestScope();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let memberCalls = 0;
    const candidates = [PARTICIPANT_FIXTURE_IDS.human, PARTICIPANT_FIXTURE_IDS.referencedHuman].map((id) => {
      const row = fixture.users.get(id);
      if (!row) throw new Error("Participant user fixture is missing");
      return row;
    });
    const input = {
      client: fixture.client,
      guildId: PARTICIPANT_FIXTURE_IDS.guild,
      simplifiedMessageHistory: fixture.history,
      personas: fixture.personas,
      activePersona: fixture.activePersona,
      visibleUserIds: visibleParticipantIds(),
      requestScope,
      candidateSource: {
        loadCandidates: async () => {
          now += 10;
          return candidates.map((userRow) => ({
            userRow,
            evidence: { hasServerActivity: true, hasPersonalMemories: false, hasPendingTasks: false },
          }));
        },
      },
      memberDirectory: {
        cachedMemberIds: () => [candidates[0].user_disc_id],
        resolveMember: async (discordId: string) => {
          if (++memberCalls === candidates.length) started.resolve();
          await release.promise;
          const member = fixture.memberCache.get(discordId);
          if (!member) return null;
          return {
            discordId,
            bot: member.user.bot,
            displayName: member.displayName,
            nickname: member.nickname,
            globalName: member.user.globalName,
            username: member.user.username,
          };
        },
      },
      messageProxyIdentitySource: {
        loadIdentities: async () => {
          now += 7;
          return [];
        },
      },
    };
    const run = () =>
      runWithChatTurnLatency(createChatLatencyInvocation(Date.now(), "message"), 0, 0, () =>
        measureChatTurnStage("participant_ms", () => prepareParticipantContext(input)),
      );
    try {
      const first = run();
      await started.promise;
      const pendingReuse = run();
      now += 30;
      release.resolve();
      await Promise.all([first, pendingReuse]);
      await run();
      const samples = metric.mock.calls.filter(([name]) => name === "chat_turn_latency").map(([, sample]) => sample);
      expect(samples).toHaveLength(3);
      expect(samples.find((sample) => sample.participant_discovery === "fresh")).toMatchObject({
        participant_ms: 47,
        participant_candidate_ms: 10,
        participant_members_ms: 30,
        participant_proxy_ms: 7,
        participant_composition_ms: 0,
        participant_discovery: "fresh",
        participant_candidate_reads: 1,
        participant_member_cache_hits: 1,
        participant_member_fetches: 1,
        participant_proxy_reads: 1,
      });
      const reused = samples.filter((sample) => sample.participant_discovery === "reused");
      expect(reused.map((sample) => sample.participant_ms).sort((a, b) => Number(a) - Number(b))).toEqual([0, 37]);
      for (const sample of reused)
        expect(sample).toMatchObject({
          participant_candidate_ms: -1,
          participant_members_ms: -1,
          participant_proxy_ms: -1,
          participant_composition_ms: 0,
          participant_discovery: "reused",
          participant_candidate_reads: 0,
          participant_member_cache_hits: 0,
          participant_member_fetches: 0,
          participant_proxy_reads: 0,
        });
    } finally {
      release.resolve();
      clock.mockRestore();
      metric.mockRestore();
      fixture.restoreRepositories();
    }
  });

  it("records failed candidate reads while leaving unreached stages unmeasured", async () => {
    const fixture = createParticipantContextFixture();
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    let now = 0;
    const clock = spyOn(performance, "now").mockImplementation(() => now);
    const failure = new Error("candidate lookup failed");
    try {
      await expect(
        runWithChatTurnLatency(createChatLatencyInvocation(Date.now(), "message"), 0, 0, () =>
          measureChatTurnStage("participant_ms", () =>
            prepareParticipantContext({
              client: fixture.client,
              guildId: PARTICIPANT_FIXTURE_IDS.guild,
              simplifiedMessageHistory: fixture.history,
              personas: fixture.personas,
              activePersona: fixture.activePersona,
              visibleUserIds: visibleParticipantIds(),
              candidateSource: {
                loadCandidates: async () => {
                  now += 5;
                  throw failure;
                },
              },
            }),
          ),
        ),
      ).rejects.toBe(failure);
      const samples = metric.mock.calls.filter(([name]) => name === "chat_turn_latency");
      expect(samples).toHaveLength(1);
      expect(samples[0][1]).toMatchObject({
        participant_ms: 5,
        participant_candidate_ms: 5,
        participant_members_ms: -1,
        participant_proxy_ms: -1,
        participant_composition_ms: -1,
        participant_discovery: "fresh",
        participant_candidate_reads: 1,
        participant_member_fetches: 0,
        participant_proxy_reads: 0,
      });
    } finally {
      clock.mockRestore();
      metric.mockRestore();
      fixture.restoreRepositories();
    }
  });

  it("excludes participant preparation outside the context-build participant stage", async () => {
    const fixture = createParticipantContextFixture();
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    try {
      const measured = await runWithChatTurnLatency(
        createChatLatencyInvocation(Date.now(), "message"),
        0,
        0,
        async () => {
          await prepare(fixture, fixture.activePersona);
          const result = await measureChatTurnStage("participant_ms", () => prepare(fixture, fixture.activePersona));
          await prepare(fixture, fixture.activePersona);
          return result;
        },
      );
      const samples = metric.mock.calls.filter(([name]) => name === "chat_turn_latency");
      expect(samples).toHaveLength(1);
      expect(samples[0][1]).toMatchObject({
        participant_discovery: "fresh",
        participant_candidate_reads: measured.diagnostics.externalCalls.candidateSourceReads,
        participant_member_cache_hits: measured.diagnostics.externalCalls.memberCacheHits,
        participant_member_fetches: measured.diagnostics.externalCalls.memberFetches,
        participant_proxy_reads: measured.diagnostics.externalCalls.messageProxyIdentityReads,
      });
      for (const field of [
        "participant_ms",
        "participant_candidate_ms",
        "participant_members_ms",
        "participant_proxy_ms",
        "participant_composition_ms",
      ]) {
        expect(samples[0][1][field]).toBeGreaterThanOrEqual(0);
      }
    } finally {
      metric.mockRestore();
      fixture.restoreRepositories();
    }
  });

  it("produces the same plan for equivalent live and snapshot inputs", async () => {
    const liveFixture = createParticipantContextFixture();
    const livePlan = await (async (): Promise<PreparedParticipantContext["discoveryPlan"]> => {
      try {
        return (await prepare(liveFixture, liveFixture.activePersona)).discoveryPlan;
      } finally {
        liveFixture.restoreRepositories();
      }
    })();

    const snapshotFixture = createParticipantContextFixture();
    try {
      const snapshotPlan = (await prepare(snapshotFixture, snapshotFixture.activePersona)).discoveryPlan;
      expect(snapshotPlan).toEqual(livePlan);
    } finally {
      snapshotFixture.restoreRepositories();
    }
  });

  it("reuses frozen discovery while rebuilding the active-persona plan", async () => {
    const fixture = createParticipantContextFixture();
    const requestScope = createParticipantRequestScope();
    const alterPersona = fixture.personas.find(
      (persona) => persona.persona_id === PARTICIPANT_FIXTURE_IDS.historicalPersona,
    );
    if (!alterPersona) throw new Error("Alter persona fixture is missing");

    try {
      const main = await prepare(fixture, fixture.activePersona, requestScope);
      const retry = await prepare(fixture, fixture.activePersona, requestScope);
      const alter = await prepare(fixture, alterPersona, requestScope);

      expect(fixture.counters.candidateQueries).toBe(1);
      expect(main.diagnostics.discoveryCacheHit).toBe(false);
      expect(main.diagnostics.externalCalls.candidateSourceReads).toBe(1);
      expect(main.diagnostics.candidateCount).toBe(2);
      expect(main.diagnostics.includedCount).toBe(6);
      expect(retry.diagnostics.discoveryCacheHit).toBe(true);
      expect(retry.diagnostics.externalCalls).toEqual({
        candidateSourceReads: 0,
        memberCacheHits: 0,
        memberFetches: 0,
        messageProxyIdentityReads: 0,
      });
      expect(alter.diagnostics.discoveryCacheHit).toBe(true);
      expect(retry.discoveryPlan).toEqual(main.discoveryPlan);
      expect(
        main.discoveryPlan.seeds.some(
          (seed) => seed.key.kind === "discord_user" && seed.key.discordId === PARTICIPANT_FIXTURE_IDS.referencedHuman,
        ),
      ).toBe(true);
      expect(main.publicPersonaProfiles.map((profile) => profile.personaId)).toEqual([
        PARTICIPANT_FIXTURE_IDS.historicalPersona,
      ]);
      expect(alter.publicPersonaProfiles.map((profile) => profile.personaId)).not.toContain(
        PARTICIPANT_FIXTURE_IDS.historicalPersona,
      );
      expect(
        main.discoveryPlan.seeds.some((seed) => seed.key.kind === "bot" && seed.reasons.has("active_identity")),
      ).toBe(true);
      expect(
        alter.discoveryPlan.seeds.some(
          (seed) =>
            seed.key.kind === "persona" &&
            seed.key.personaId === PARTICIPANT_FIXTURE_IDS.historicalPersona &&
            seed.reasons.has("active_identity"),
        ),
      ).toBe(true);
      expect(Object.keys(main.diagnostics.rejectionCounts).sort()).toEqual([
        "ambiguous_alias",
        "blocked_source",
        "bot",
        "existing_participant",
        "ineligible_state",
        "missing_guild",
        "non_member",
      ]);
    } finally {
      fixture.restoreRepositories();
    }
  });

  it("does not reuse discovery when the sanitized visible input changes", async () => {
    const fixture = createParticipantContextFixture();
    const requestScope = createParticipantRequestScope();
    try {
      const first = await prepare(fixture, fixture.activePersona, requestScope);
      const changedHistory = fixture.history.map((message, index) =>
        index === 0 ? { ...message, content: `${message.content ?? ""} changed` } : message,
      );
      const changed = await prepare(fixture, fixture.activePersona, requestScope, changedHistory);

      expect(first.diagnostics.discoveryCacheHit).toBe(false);
      expect(changed.diagnostics.discoveryCacheHit).toBe(false);
      expect(fixture.counters.candidateQueries).toBe(2);
    } finally {
      fixture.restoreRepositories();
    }
  });
});
