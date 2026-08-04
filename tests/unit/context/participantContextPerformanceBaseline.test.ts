import { describe, expect, it } from "bun:test";
import type { GuildMember } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { createParticipantRequestScope } from "@/utils/text/participants/preparation";
import {
  buildPreparedParticipantContext,
  createParticipantContextFixture,
  PARTICIPANT_FIXTURE_IDS,
  type ParticipantContextFixture,
} from "./fixtures/participantContextFixture";

function addReferenceCandidates(fixture: ParticipantContextFixture, count: number): string[] {
  const templateRow = fixture.users.get(PARTICIPANT_FIXTURE_IDS.referencedHuman);
  const templateMember = fixture.memberCache.get(PARTICIPANT_FIXTURE_IDS.referencedHuman);
  if (!templateRow || !templateMember) throw new Error("Reference candidate templates are missing");
  fixture.memberCache.hits = 0;

  const ids: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const discordId = (410000000000000000n + BigInt(index)).toString();
    const nickname = `Candidate ${index}`;
    const row: UserRow = {
      ...templateRow,
      user_id: 1000 + index,
      user_disc_id: discordId,
      user_nickname: nickname,
      physical_appearance_tags: [],
    };
    const member = {
      ...templateMember,
      id: discordId,
      displayName: `${nickname} Display`,
      nickname: `${nickname} Guild`,
      user: {
        ...templateMember.user,
        id: discordId,
        globalName: `${nickname} Global`,
        username: `candidate_${index}`,
      },
    } as GuildMember;

    ids.push(discordId);
    fixture.users.set(discordId, row);
    fixture.eligibleReferenceCandidates.push(row);
    fixture.memberCache.set(discordId, member);
  }

  const historyHead = fixture.history[0];
  if (!historyHead) throw new Error("Reference history fixture is missing");
  fixture.history[0] = {
    ...historyHead,
    content: `${historyHead.content ?? ""} ${ids.map((_, index) => `Candidate ${index + 1}`).join(" ")}`,
  };
  return ids;
}

describe("participant context Phase 0 performance baseline", () => {
  it("keeps candidate and member I/O bounded without a full-guild member fetch", async () => {
    const fixtureSizes = [0, 5, 20, 50];
    const observedCandidateCounts: number[] = [];
    const observedTargetCounts: number[] = [];

    for (const extraCandidateCount of fixtureSizes) {
      const fixture = createParticipantContextFixture();
      try {
        const addedCandidateIds = addReferenceCandidates(fixture, extraCandidateCount);
        const item = await buildPreparedParticipantContext(fixture);
        const eligibleCandidateCount = 1 + extraCandidateCount;
        const hydratedDiscordUserCount = 1 + eligibleCandidateCount;

        observedCandidateCounts.push(eligibleCandidateCount);
        observedTargetCounts.push(item.conversationUsers?.length ?? 0);
        expect(item.conversationUsers?.map((user) => user.targetId)).toEqual([
          PARTICIPANT_FIXTURE_IDS.human,
          ...addedCandidateIds,
          PARTICIPANT_FIXTURE_IDS.referencedHuman,
          PARTICIPANT_FIXTURE_IDS.matrix,
        ]);
        expect(fixture.counters).toEqual({
          userRowLoads: 1,
          candidateQueries: 1,
          registrations: 0,
          blacklistReads: hydratedDiscordUserCount,
          privacyReads: hydratedDiscordUserCount,
          personalMemoryReads: hydratedDiscordUserCount,
          reminderReads: hydratedDiscordUserCount + 1,
          memberFetches: hydratedDiscordUserCount,
          fullGuildMemberFetches: 0,
        });
      } finally {
        fixture.restoreRepositories();
      }
    }

    expect(observedCandidateCounts).toEqual([1, 6, 21, 51]);
    expect(observedTargetCounts).toEqual([3, 8, 23, 53]);
  });

  it("reuses discovery without extending persona-scoped hydration freshness", async () => {
    const fixture = createParticipantContextFixture();
    const requestScope = createParticipantRequestScope();
    try {
      await buildPreparedParticipantContext(fixture, { requestScope });
      await buildPreparedParticipantContext(fixture, { requestScope });

      expect(fixture.counters.candidateQueries).toBe(1);
      expect(fixture.counters.memberFetches).toBe(4);
      expect(fixture.counters.blacklistReads).toBe(4);
      expect(fixture.counters.privacyReads).toBe(4);
      expect(fixture.counters.personalMemoryReads).toBe(4);
      expect(fixture.counters.reminderReads).toBe(6);
      expect(fixture.counters.fullGuildMemberFetches).toBe(0);
    } finally {
      fixture.restoreRepositories();
    }
  });
});
