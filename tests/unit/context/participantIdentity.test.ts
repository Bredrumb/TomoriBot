import { describe, expect, it } from "bun:test";
import {
  createBotKey,
  createDiscordUserKey,
  createMatrixUserKey,
  createPersonaKey,
  createWebhookKey,
  mergeParticipantSeeds,
  participantKeyDebugLabel,
  participantKeysEqual,
  serializeParticipantKey,
  type ParticipantSeed,
} from "@/utils/text/participants/identity";
import { adaptLegacyParticipantSeeds, adaptLegacySyntheticParticipants } from "@/utils/text/participants/legacyAdapter";

describe("typed participant identity", () => {
  it("keeps Discord users, bots, webhooks, personas, and Matrix users collision-safe", () => {
    const sharedNumericId = "123456789012345678";
    const keys = [
      createDiscordUserKey(sharedNumericId),
      createBotKey(sharedNumericId),
      createWebhookKey(sharedNumericId),
      createPersonaKey(7),
      createMatrixUserKey("@7:example.test"),
    ];
    const serialized = keys.map(serializeParticipantKey);

    expect(new Set(serialized).size).toBe(keys.length);
    expect(serialized).toEqual([
      `discord_user:${sharedNumericId}`,
      `bot:${sharedNumericId}`,
      `webhook:${sharedNumericId}`,
      "persona:7",
      "matrix_user:@7:example.test",
    ]);
    expect(keys.map(participantKeyDebugLabel)).toEqual(serialized);
  });

  it("compares identity by kind and stable identifier", () => {
    expect(participantKeysEqual(createDiscordUserKey("100"), createDiscordUserKey("100"))).toBe(true);
    expect(participantKeysEqual(createDiscordUserKey("100"), createBotKey("100"))).toBe(false);
    expect(participantKeysEqual(createPersonaKey(100), createWebhookKey("100"))).toBe(false);
  });

  it("rejects empty identifiers and invalid persona IDs", () => {
    expect(() => createDiscordUserKey("  ")).toThrow("Discord user ID must not be empty");
    expect(() => createWebhookKey("")).toThrow("Webhook ID must not be empty");
    expect(() => createMatrixUserKey(" ")).toThrow("Matrix user ID must not be empty");
    expect(() => createPersonaKey(-1)).toThrow("Persona ID must be a non-negative safe integer");
    expect(() => createPersonaKey(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      "Persona ID must be a non-negative safe integer",
    );
  });

  it("merges repeated reasons without changing first-seen order", () => {
    const seeds: ParticipantSeed[] = [
      {
        key: createPersonaKey(7),
        reasons: new Set(["historical_persona"]),
        aliases: [],
        capabilities: new Set(),
        firstSeenOrder: 3,
        sourceDisplayName: "Ren",
      },
      {
        key: createDiscordUserKey("100"),
        reasons: new Set(["visible_author"]),
        aliases: [],
        capabilities: new Set(["mentionable"]),
        firstSeenOrder: 1,
        sourceDisplayName: "Alice",
      },
      {
        key: createPersonaKey(7),
        reasons: new Set(["co_responder", "persona_trigger_reference"]),
        aliases: [],
        capabilities: new Set(),
        firstSeenOrder: 0,
      },
    ];

    const merged = mergeParticipantSeeds(seeds);
    expect(merged.map((seed) => serializeParticipantKey(seed.key))).toEqual(["persona:7", "discord_user:100"]);
    expect(merged[0]?.firstSeenOrder).toBe(0);
    expect(merged[0]?.sourceDisplayName).toBe("Ren");
    expect(merged[0]?.reasons).toEqual(new Set(["historical_persona", "co_responder", "persona_trigger_reference"]));
  });
});

describe("legacy participant compatibility adapter", () => {
  it("converts legacy lists and maps to typed seeds with stable first-seen order", () => {
    const referencedReasons = new Map([
      ["400000000000000001", new Set<"real_mention" | "unique_text_alias">(["real_mention"])],
    ]);
    const personaReasons = new Map([[8, new Set(["historical_persona", "co_responder"] as const)]]);
    const seeds = adaptLegacyParticipantSeeds({
      userList: ["300000000000000001", "400000000000000001", "7", "persona:7", "500000000000000001"],
      clientUserId: "300000000000000001",
      activePersonaId: 7,
      syntheticUsers: new Map([["500000000000000001", { displayName: "Webhook Guest", type: "webhook" }]]),
      matrixUsers: new Map([["@mika:example.test", "Mika"]]),
      referencedUserReasons: referencedReasons,
      publicPersonaProfiles: [{ personaId: 8, personaName: "Ren" }],
      personaProfileReasons: personaReasons,
    });

    expect(seeds.map((seed) => serializeParticipantKey(seed.key))).toEqual([
      "bot:300000000000000001",
      "discord_user:400000000000000001",
      "persona:7",
      "webhook:500000000000000001",
      "matrix_user:@mika:example.test",
      "persona:8",
    ]);
    expect(seeds.map((seed) => seed.firstSeenOrder)).toEqual([0, 1, 2, 4, 6, 7]);
    expect(seeds[1]?.reasons).toEqual(new Set(["real_mention"]));
    expect(seeds[2]?.reasons).toEqual(new Set(["active_identity"]));
    expect(seeds[5]?.reasons).toEqual(new Set(["historical_persona", "co_responder"]));
  });

  it("converts legacy synthetic maps into typed transport-owned definitions", () => {
    expect(
      adaptLegacySyntheticParticipants(
        new Map([
          ["persona:7", { displayName: "Ren", type: "persona" }],
          ["500000000000000001", { displayName: "Guest", type: "webhook" }],
        ]),
        new Map([["@mika:example.test", "Mika"]]),
      ),
    ).toEqual([
      { key: createPersonaKey(7), displayName: "Ren", transport: "persona_webhook" },
      { key: createWebhookKey("500000000000000001"), displayName: "Guest", transport: "webhook" },
      { key: createMatrixUserKey("@mika:example.test"), displayName: "Mika", transport: "matrix" },
    ]);
  });

  it("represents an active alter once even when both bot and persona legacy IDs are present", () => {
    const seeds = adaptLegacyParticipantSeeds({
      userList: ["300000000000000001", "7", "persona:7"],
      clientUserId: "300000000000000001",
      activePersonaId: 7,
      activePersonaIsAlter: true,
    });

    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({
      key: createPersonaKey(7),
      firstSeenOrder: 0,
    });
    expect(seeds[0]?.reasons).toEqual(new Set(["active_identity"]));
  });

  it("rejects conflicting or malformed legacy source combinations", () => {
    expect(() =>
      adaptLegacyParticipantSeeds({
        userList: ["300000000000000001"],
        clientUserId: "300000000000000001",
        syntheticUsers: new Map([["300000000000000001", { displayName: "Impossible", type: "webhook" }]]),
      }),
    ).toThrow("cannot be both the active bot and a synthetic user");
    expect(() =>
      adaptLegacyParticipantSeeds({
        userList: ["not-a-persona-id"],
        syntheticUsers: new Map([["not-a-persona-id", { displayName: "Broken", type: "persona" }]]),
      }),
    ).toThrow("does not contain a valid persona ID");
    expect(() =>
      adaptLegacySyntheticParticipants(
        new Map([["same", { displayName: "Webhook", type: "webhook" }]]),
        new Map([["same", "Matrix"]]),
      ),
    ).toThrow("cannot be both a synthetic webhook and a Matrix user");
  });
});
