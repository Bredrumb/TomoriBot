import { describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import { PrivacyLevel, type TomoriState, type UserRow } from "@/types/db/schema";
import {
  CONTEXT_REFERENCE_ELIGIBILITY_POLICY_VERSION,
  isEligibleContextReferenceUserV1,
  type ContextReferenceCandidate,
} from "@/utils/db/repositories/UserRepository";
import { createDiscordParticipantMemberDirectory } from "@/utils/text/participants/candidateSources";
import {
  buildParticipantDiscoveryPlan,
  composeParticipantDiscoveryPlan,
  discoverPersonaReferenceCandidates,
} from "@/utils/text/participants/discoveryPlan";
import { buildDiscordUserAliases } from "@/utils/text/participants/aliases";
import { createDiscordUserKey, serializeParticipantKey } from "@/utils/text/participants/identity";
import { resolveContextReferences } from "@/utils/text/contextReferences";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";

const ELIGIBLE_EVIDENCE = {
  hasServerActivity: true,
  hasPersonalMemories: false,
  hasPendingTasks: false,
};

const INELIGIBLE_EVIDENCE = {
  hasServerActivity: false,
  hasPersonalMemories: false,
  hasPendingTasks: false,
};

function userRow(discordId: string, nickname: string): UserRow {
  return {
    user_id: Number.parseInt(discordId, 10),
    user_disc_id: discordId,
    user_nickname: nickname,
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
    timezone_offset: null,
  };
}

function persona(personaId: number, nickname: string, triggerWords: string[]): TomoriState {
  return {
    persona_id: personaId,
    persona_nickname: nickname,
    trigger_words: triggerWords,
    persona_attributes: [],
    physical_appearance_tags: [],
  } as unknown as TomoriState;
}

function message(content: string, id = "history-1"): SimplifiedMessageForContext {
  return {
    id,
    authorId: "author",
    authorName: "Author",
    authorType: "user",
    content,
    imageAttachments: [],
    videoAttachments: [],
  };
}

function referenceMember(discordId: string, displayName: string, bot = false) {
  return {
    discordId,
    bot,
    displayName,
    nickname: displayName,
    globalName: displayName,
    username: `${displayName.toLowerCase()}_user`,
  };
}

describe("participant discovery plan", () => {
  it("is pure, merges multiple reasons, and retains active-turn-independent aliases and evidence", () => {
    const ren = persona(2, "Ren", ["lilya", "ren"]);
    const referencePlan = buildParticipantDiscoveryPlan({
      candidates: [
        {
          key: createDiscordUserKey("200"),
          reasons: new Set(["real_mention", "unique_text_alias"]),
          aliases: buildDiscordUserAliases({
            owner: createDiscordUserKey("200"),
            userRow: { user_nickname: "Bob" },
            identity: { displayName: "Bob", nickname: null, globalName: "Bob", username: "bob" },
            exposeSavedNickname: false,
          }),
          sourceDisplayName: "Bob",
          evidenceSources: ["real_mention", "unique_text_alias"],
        },
        ...discoverPersonaReferenceCandidates(
          [ren],
          new Map([[2, new Set(["historical_persona", "co_responder", "persona_trigger_reference"] as const)]]),
        ),
      ],
    });

    const plan = composeParticipantDiscoveryPlan({
      visibleInput: {
        userList: ["100", "999", "persona:2"],
        clientUserId: "999",
        activePersonaId: 1,
        activePersonaIsAlter: false,
        syntheticUsers: new Map([["persona:2", { displayName: "Ren", type: "persona" }]]),
        matrixUsers: new Map([["@mika:example.org", "Mika Matrix"]]),
      },
      personas: [persona(1, "Tomori", ["tomori"]), ren],
      referencePlan,
    });

    expect(plan.seeds.map((seed) => serializeParticipantKey(seed.key))).toEqual([
      "discord_user:100",
      "bot:999",
      "persona:2",
      "discord_user:200",
      "matrix_user:@mika:example.org",
    ]);
    const renSeed = plan.seeds.find((seed) => serializeParticipantKey(seed.key) === "persona:2");
    expect(renSeed?.reasons).toEqual(new Set(["historical_persona", "co_responder", "persona_trigger_reference"]));
    expect(renSeed?.aliases.some((alias) => alias.source === "persona_trigger" && alias.value === "lilya")).toBe(true);
    expect(
      plan.evidence
        .filter((item) => serializeParticipantKey(item.key) === "discord_user:200")
        .map((item) => item.source),
    ).toEqual(["real_mention", "unique_text_alias"]);
  });

  it("produces equivalent live and snapshot plans from equivalent sanitized sources", () => {
    const personas = [persona(1, "Tomori", ["tomori"]), persona(2, "Ren", ["ren"])];
    const referencePlan = buildParticipantDiscoveryPlan({ candidates: [] });
    const input = {
      userList: ["100", "999"],
      clientUserId: "999",
      activePersonaId: 1,
      activePersonaIsAlter: false,
      syntheticUsers: new Map<string, { displayName: string; type: "persona" | "webhook" }>(),
      matrixUsers: new Map([["@mika:example.org", "Mika Matrix"]]),
    };
    const normalize = (plan: ReturnType<typeof composeParticipantDiscoveryPlan>) => ({
      seeds: plan.seeds.map((seed) => ({
        key: serializeParticipantKey(seed.key),
        reasons: [...seed.reasons],
        aliases: seed.aliases.map((alias) => [alias.source, alias.normalized]),
        firstSeenOrder: seed.firstSeenOrder,
      })),
      evidence: plan.evidence.map((item) => [serializeParticipantKey(item.key), item.source, item.firstSeenOrder]),
    });

    const livePlan = composeParticipantDiscoveryPlan({ visibleInput: input, personas, referencePlan });
    const snapshotPlan = composeParticipantDiscoveryPlan({
      visibleInput: {
        ...input,
        userList: [...input.userList],
        syntheticUsers: new Map(input.syntheticUsers),
        matrixUsers: new Map(input.matrixUsers),
      },
      personas: [...personas],
      referencePlan,
    });
    expect(normalize(snapshotPlan)).toEqual(normalize(livePlan));
  });
});

describe("participant candidate sources", () => {
  it("uses cached members before one targeted uncached fetch and never fetches the full member list", async () => {
    let targetedFetches = 0;
    let fullFetches = 0;
    const cachedMember = {
      id: "100",
      displayName: "Cached",
      nickname: "Cached",
      user: { bot: false, globalName: "Cached", username: "cached" },
    };
    const uncachedMember = {
      id: "200",
      displayName: "Uncached",
      nickname: null,
      user: { bot: false, globalName: "Uncached", username: "uncached" },
    };
    const guild = {
      members: {
        cache: new Map([["100", cachedMember]]),
        fetch: async (discordId?: string) => {
          if (!discordId) {
            fullFetches += 1;
            return null;
          }
          targetedFetches += 1;
          return discordId === "200" ? uncachedMember : null;
        },
      },
    };
    const client = { guilds: { cache: new Map([["guild", guild]]) } } as unknown as Client;
    const directory = createDiscordParticipantMemberDirectory(client, "guild");

    expect(directory?.cachedMemberIds()).toEqual(["100"]);
    expect(await directory?.resolveMember("100")).toMatchObject({ discordId: "100", displayName: "Cached" });
    expect(await directory?.resolveMember("200")).toMatchObject({ discordId: "200", displayName: "Uncached" });
    expect(targetedFetches).toBe(1);
    expect(fullFetches).toBe(0);
  });

  it("returns aggregate rejection reasons while deduplicating membership verification", async () => {
    const candidates: ContextReferenceCandidate[] = [
      { userRow: userRow("100", "Alice"), evidence: ELIGIBLE_EVIDENCE },
      { userRow: userRow("100", "Alice"), evidence: ELIGIBLE_EVIDENCE },
      { userRow: userRow("200", "Bot"), evidence: ELIGIBLE_EVIDENCE },
      { userRow: userRow("300", "Absent"), evidence: ELIGIBLE_EVIDENCE },
      { userRow: userRow("400", "Default"), evidence: INELIGIBLE_EVIDENCE },
      { userRow: userRow("500", "Apple"), evidence: ELIGIBLE_EVIDENCE },
      { userRow: userRow("600", "apple"), evidence: ELIGIBLE_EVIDENCE },
      { userRow: userRow("700", "Bob"), evidence: ELIGIBLE_EVIDENCE },
    ];
    let candidateQueries = 0;
    const memberLookups = new Map<string, number>();
    const members = new Map([
      ["100", referenceMember("100", "Alice")],
      ["200", referenceMember("200", "Bot", true)],
      ["500", referenceMember("500", "Apple")],
      ["600", referenceMember("600", "apple")],
      ["700", referenceMember("700", "Bob")],
    ]);
    const resolved = await resolveContextReferences({
      client: {} as Client,
      guildId: "guild",
      simplifiedMessageHistory: [
        message("Alice and Apple should ask Bob <@700>.", "visible"),
        message("Blocked user Apple is excluded.", "synthetic-user-block-hidden"),
      ],
      personas: [],
      existingParticipantIds: new Set(["100"]),
      candidateSource: {
        loadCandidates: async () => {
          candidateQueries += 1;
          return candidates;
        },
      },
      memberDirectory: {
        cachedMemberIds: () => ["100", "200", "300", "400", "500", "600", "700"],
        resolveMember: async (discordId) => {
          memberLookups.set(discordId, (memberLookups.get(discordId) ?? 0) + 1);
          return members.get(discordId) ?? null;
        },
      },
    });

    expect(resolved.referencedUserIds).toEqual(new Set(["700"]));
    expect(resolved.referencedUserReasons.get("700")).toEqual(new Set(["unique_text_alias", "real_mention"]));
    expect(new Map(resolved.discoveryPlan.rejections.map((rejection) => [rejection.reason, rejection.count]))).toEqual(
      new Map([
        ["blocked_source", 1],
        ["ineligible_state", 1],
        ["bot", 1],
        ["non_member", 1],
        ["ambiguous_alias", 1],
        ["existing_participant", 1],
      ]),
    );
    expect(candidateQueries).toBe(1);
    expect(memberLookups.get("100")).toBe(1);
    expect(memberLookups.has("400")).toBe(false);
  });

  it("reports a missing guild without consulting a candidate source", async () => {
    let candidateQueries = 0;
    const resolved = await resolveContextReferences({
      client: {} as Client,
      guildId: "missing",
      simplifiedMessageHistory: [message("Ask Alice.")],
      personas: [],
      existingParticipantIds: new Set(),
      candidateSource: {
        loadCandidates: async () => {
          candidateQueries += 1;
          return [];
        },
      },
      memberDirectory: null,
    });

    expect(resolved.discoveryPlan.rejections).toEqual([{ reason: "missing_guild", count: 1 }]);
    expect(candidateQueries).toBe(0);
  });
});

describe("context reference eligibility policy v1", () => {
  it("keeps the pure policy version explicit and preserves default-only rejection", () => {
    expect(CONTEXT_REFERENCE_ELIGIBILITY_POLICY_VERSION).toBe(1);
    expect(isEligibleContextReferenceUserV1(userRow("100", "Default"), INELIGIBLE_EVIDENCE)).toBe(false);
    expect(isEligibleContextReferenceUserV1(userRow("100", "Active"), ELIGIBLE_EVIDENCE)).toBe(true);
  });
});
