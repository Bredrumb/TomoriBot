import { describe, expect, it } from "bun:test";
import {
  createBotKey,
  createDiscordUserKey,
  createMatrixUserKey,
  createPersonaKey,
  createWebhookKey,
  mergeParticipantSeeds,
  participantKeysEqual,
  serializeParticipantKey,
  type ParticipantSeed,
} from "@/utils/text/participants/identity";

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
